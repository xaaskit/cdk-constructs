import { external } from "./external";

export async function handler(event: AWSLambda.CloudFormationCustomResourceEvent) {
  if (event.RequestType === 'Create') { return onCreate(event); }
  if (event.RequestType === 'Update') { return onUpdate(event); }
  if (event.RequestType === 'Delete') { return onDelete(event); }
  throw new Error('invalid request type');
}

async function onCreate(event: AWSLambda.CloudFormationCustomResourceCreateEvent) {
  const token = await external.resolveGitHubToken(event.ResourceProperties.GitHubToken, event.ResourceProperties.GitHubTokenSecretId)

  const owner = event.ResourceProperties.Owner;
  const repository = event.ResourceProperties.Repository;
  
  const response = await external.createGitHubWebhook({
    token,
    owner,
    repository,
    events: event.ResourceProperties.RepositoryEvents,
    url: event.ResourceProperties.WebhookUrl,
    active: event.ResourceProperties.WebbookActive
    
  });
  const resourceId = [repository, owner, response.id].join(':');
  return {
    PhysicalResourceId: resourceId
  };
}

async function onUpdate(event: AWSLambda.CloudFormationCustomResourceUpdateEvent) {
  const repository = event.OldResourceProperties.Repository;
  const owner = event.OldResourceProperties.RepositoryOwner;

  const oldRepository = event.OldResourceProperties.Repository;
  const oldRepositoryOwner = event.OldResourceProperties.RepositoryOwner;

  // Create a new WebHook and let CloudFormation delete the old one as the PhysicalResourceId changes.
  if (repository != oldRepository || owner != oldRepositoryOwner) {
    return onCreate({ ...event, RequestType: 'Create' });
  }

  const id = event.PhysicalResourceId.split(':')[2];
  const token = await external.resolveGitHubToken(event.ResourceProperties.GitHubToken, event.ResourceProperties.GitHubTokenSecretId)
  await external.updateGitHubWebhook({
    id,
    token,
    owner,
    repository,
    events: event.ResourceProperties.RepositoryEvents,
    url: event.ResourceProperties.WebhookUrl,
    active: event.ResourceProperties.WebbookActive  
  });
  return;
}

async function onDelete(event: AWSLambda.CloudFormationCustomResourceDeleteEvent) {
  const fragments = event.PhysicalResourceId.split(':');
  const owner = fragments[0];
  const repository = fragments[1];
  const id = fragments[2];
  
  const token = await external.resolveGitHubToken(event.ResourceProperties.GitHubToken, event.ResourceProperties.GitHubTokenSecretId)
  await external.deleteGitHubWebhook({
    id,
    token,
    owner,
    repository,
  });
  return;
}