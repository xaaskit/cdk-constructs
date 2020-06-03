import { external } from "./external";

export async function handler(event: AWSLambda.CloudFormationCustomResourceEvent) {
  if (event.RequestType === 'Create') { return onCreate(event); }
  if (event.RequestType === 'Update') { return onUpdate(event); }
  if (event.RequestType === 'Delete') { return onDelete(event); }
  throw new Error('invalid request type');
}

async function onCreate(event: AWSLambda.CloudFormationCustomResourceCreateEvent) {
  const token = await external.resolveGitHubToken(event.ResourceProperties.GitHubAccessToken)

  const owner = event.ResourceProperties.RepositoryOwner;
  const repository = event.ResourceProperties.Repository;
  
  const response = await external.createGitHubWebhook({
    token,
    owner,
    repository,
    events: event.ResourceProperties.RepositoryEvents,
    url: event.ResourceProperties.WebhookUrl,
    active: event.ResourceProperties.WebhookActive === 'true',
    
  });
  return {
    PhysicalResourceId: response.id.toString(),
    Url: response.url,
  };
}

async function onUpdate(event: AWSLambda.CloudFormationCustomResourceUpdateEvent) {
  const repository = event.OldResourceProperties.Repository;
  const owner = event.OldResourceProperties.RepositoryOwner;

  const oldRepository = event.OldResourceProperties.Repository;
  const oldRepositoryOwner = event.OldResourceProperties.RepositoryOwner;

  const id = event.PhysicalResourceId;

  // Create a new WebHook and let CloudFormation delete the old one as the PhysicalResourceId changes.
  if (!id || repository != oldRepository || owner != oldRepositoryOwner) {
    return onCreate({ ...event, RequestType: 'Create' });
  }

  const token = await external.resolveGitHubToken(event.ResourceProperties.GitHubAccessToken)
  await external.updateGitHubWebhook({
    id,
    token,
    owner,
    repository,
    events: event.ResourceProperties.RepositoryEvents,
    url: event.ResourceProperties.WebhookUrl,
    active: event.ResourceProperties.WebhookActive === 'true',
  });
  return;
}

async function onDelete(event: AWSLambda.CloudFormationCustomResourceDeleteEvent) {
  const id = event.PhysicalResourceId;
  const repository = event.ResourceProperties.Repository;
  const owner = event.ResourceProperties.RepositoryOwner;

  if (id) {
    try {
      const token = await external.resolveGitHubToken(event.ResourceProperties.GitHubAccessToken)
      await external.deleteGitHubWebhook({
        id,
        token,
        owner,
        repository,
      });
    } catch(e) { } // Don't bother just remove the resource
  }

  return;
}