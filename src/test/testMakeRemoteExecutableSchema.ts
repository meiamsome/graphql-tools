/* tslint:disable:no-unused-expression */

import { expect } from 'chai';
import { forAwaitEach } from 'iterall';
import { GraphQLSchema, ExecutionResult, subscribe, parse, execute, print } from 'graphql';
import {
  subscriptionSchema,
  subscriptionPubSubTrigger,
  subscriptionPubSub,
  makeSchemaRemoteFromLink
} from '../test/testingSchemas';
import { makeRemoteExecutableSchema } from '../stitching';
import { FetcherOperation } from '../stitching/makeRemoteExecutableSchema';

describe('remote subscriptions', () => {
  let schema: GraphQLSchema;
  before(async () => {
    schema = await makeSchemaRemoteFromLink(subscriptionSchema);
  });

  it('should work', done => {
    const mockNotification = {
      notifications: {
        text: 'Hello world'
      }
    };

    const subscription = parse(`
      subscription Subscription {
        notifications {
          text
        }
      }
    `);

    let notificationCnt = 0;
    subscribe(schema, subscription).then(results =>
      forAwaitEach(results as AsyncIterable<ExecutionResult>, (result: ExecutionResult) => {
        expect(result).to.have.property('data');
        expect(result.data).to.deep.equal(mockNotification);
        !notificationCnt++ ? done() : null;
      })
    );

    setTimeout(() => {
      subscriptionPubSub.publish(subscriptionPubSubTrigger, mockNotification);
    });
  });

  it('should work without triggering multiple times per notification', done => {
    const mockNotification = {
      notifications: {
        text: 'Hello world'
      }
    };

    const subscription = parse(`
      subscription Subscription {
        notifications {
          text
        }
      }
    `);

    let notificationCnt = 0;
    subscribe(schema, subscription).then(results =>
      forAwaitEach(results as AsyncIterable<ExecutionResult>, (result: ExecutionResult) => {
        expect(result).to.have.property('data');
        expect(result.data).to.deep.equal(mockNotification);
        notificationCnt++;
      })
    );

    subscribe(schema, subscription).then(results =>
      forAwaitEach(results as AsyncIterable<ExecutionResult>, (result: ExecutionResult) => {
        expect(result).to.have.property('data');
        expect(result.data).to.deep.equal(mockNotification);
      })
    );

    setTimeout(() => {
      subscriptionPubSub.publish(subscriptionPubSubTrigger, mockNotification);
      subscriptionPubSub.publish(subscriptionPubSubTrigger, mockNotification);
      setTimeout(() => {
        expect(notificationCnt).to.eq(2);
        done();
      });
    });
  });
});

describe('respects buildSchema options', () => {
  const schema = `
  type Query {
    # Field description
    custom: CustomScalar!
  }

  # Scalar description
  scalar CustomScalar
`;

  it('without comment descriptions', () => {
    const remoteSchema = makeRemoteExecutableSchema({ schema });

    const customScalar = remoteSchema.getType('CustomScalar');
    expect(customScalar.description).to.eq(undefined);
  });

  it('with comment descriptions', () => {
    const remoteSchema = makeRemoteExecutableSchema({
      schema,
      buildSchemaOptions: { commentDescriptions: true }
    });

    const field = remoteSchema.getQueryType().getFields()['custom'];
    expect(field.description).to.eq('Field description');
    const customScalar = remoteSchema.getType('CustomScalar');
    expect(customScalar.description).to.eq('Scalar description');
  });
});

describe('when query for multiple fields', () => {
  const schema = `
    type Query {
      fieldA: Int!
      fieldB: Int!
      field3: Int!
    }
  `;
  const query = parse(`
    query {
      fieldA
      fieldB
      field3
    }
  `);
  let calls: FetcherOperation[] = [];
  const fetcher = (args: FetcherOperation) => {
    calls.push(args);
    return Promise.resolve({
      data: {
        fieldA: 1,
        fieldB: 2,
        field3: 3,
      }
    });
  };
  const remoteSchema = makeRemoteExecutableSchema({
    fetcher,
    schema,
  });

  beforeEach(() => {
    calls = [];
  });

  // One of the two tests below should work depending upon what the correct intended behaviour is
  it('forwards one upstream query', async () => {
    const result = await execute(remoteSchema, query);
    expect(result).to.deep.equal({
      data: {
        fieldA: 1,
        fieldB: 2,
        field3: 3,
      }
    })

    expect(calls).to.have.length(1);
    expect(print(calls[0].query)).to.be.equal(print(query));
  });

  it('forwards three upstream queries', async () => {
    const result = await execute(remoteSchema, query);
    expect(result).to.deep.equal({
      data: {
        fieldA: 1,
        fieldB: 2,
        field3: 3,
      }
    })

    expect(calls).to.have.length(3);
    expect(print(calls[0].query)).to.be.equal(`\
{
  fieldA
}
`);
expect(print(calls[1].query)).to.be.equal(`\
{
  fieldB
}
`);
expect(print(calls[2].query)).to.be.equal(`\
{
  field3
}
`);
  });
});
