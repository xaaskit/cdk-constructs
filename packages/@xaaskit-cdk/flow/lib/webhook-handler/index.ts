import { external } from './external';

const stateMachineArn = process.env.STATE_MACHINE_ARN ?? "";
const productionHostname = process.env.PRODUCTION_HOSTNAME ?? "";
const productionClusterName = process.env.PRODUCTION_CLUSTER_NAME ?? "";
const productionClusterNamespace = process.env.PRODUCTION_CLUSTER_NAMESPACE ?? "default";
const developmentHostname = process.env.DEVELOPMENT_HOSTNAME ?? productionHostname;
const developmentClusterName = process.env.DEVELOPMENT_CLUSTER_NAME ?? productionClusterName;
const developmentClusterNamespace = process.env.DEVELOPMENT_CLUSTER_NAMESPACE ?? productionClusterNamespace;

async function onPush(event: any) {
  if (event.ref !== `refs/heads/${event.repository.default_branch}`) { // Only trigger the pipeline for the default branch
    return;
  }
  external.log(`Handle push: ref=${event.ref}`);
  const data = {
    Webhook: {
      Commit: {
        Id: event.head_commit.id,
        Version: event.head_commit.id.sha.substring(0, 12),
        Ref: event.ref,
      },
      Deployment: {
        Hostname: productionHostname,
        ClusterName: productionClusterName,
        ClusterNamespace: productionClusterNamespace,
      }
    }
  };
  await external.startExecution({ stateMachineArn, input: JSON.stringify(data) });
}

async function onPullRequest(event: any) {
  if (event.action !== 'opened' || event.action !== 'synchronize') {
    return;
  }
  external.log(`Handle Pull Request: number=${event.pull_request.number};ref=${event.pull_request.head.ref}`);
  const data = {
    Webhook: {
      Commit: {
        Id: event.pull_request.head.sha,
        Version: event.pull_request.head.sha.substring(0, 12),
        Ref: event.pull_request.head.ref,
      },
      PullRequest: {
        Number: event.pull_request.number,
        Url: event.pull_request.url,
        CommentsUrl: event.pull_request.comments_url,
        StatusesUrl: event.pull_request.statusus_url,
      },
      Deployment: {
        Hostname: `pr-${event.pull_request.number}.${developmentHostname}`,
        ClusterName: developmentClusterName,
        ClusterNamespace: developmentClusterNamespace, 
      }
    }
  };
  await external.startExecution({ stateMachineArn, input: JSON.stringify(data) });
}

export async function handler(event: AWSLambda.APIGatewayEvent) {
  external.log(`API Gateway Event: ${JSON.stringify(event)}`);
  const eventType = event.headers['x-github-event'];
  if (eventType === 'push') { return onPush(JSON.stringify(event.body)); }
  if (eventType === 'pull_request') { return onPullRequest(JSON.stringify(event.body)); }
  external.log(`Unhandled request type: ${eventType}`);
}
