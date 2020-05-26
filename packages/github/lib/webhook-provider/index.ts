import { external } from "./external";

export async function handler(event: AWSLambda.CloudFormationCustomResourceEvent) {
  if (event.RequestType === 'Create') { return onCreate(event); }
  if (event.RequestType === 'Update') { return onUpdate(event); }
  if (event.RequestType === 'Delete') { return onDelete(event); }
  throw new Error('invalid request type');
}

async function onCreate(event: AWSLambda.CloudFormationCustomResourceCreateEvent) {
  const owner = event.ResourceProperties.Owner;
  const repository = event.ResourceProperties.Owner.Repository;
  const tokenSecretId = event.ResourceProperties.TokenSecretId;
  const endpoint = event.ResourceProperties.Endpoint;
  const events = event.ResourceProperties.Events;
  

  const tokenResp = await external.getSecretValue({ SecretId: tokenSecretId });
  if (!tokenResp.SecretString) {
    external.log(`GitHub token not found! Please create and set the ${tokenSecretId} with a GitHub OAuth token.`);
  }
  const webhookResponse = await external.createWebhook(owner, repository, tokenResp.SecretString!, endpoint, events);
  console.log(JSON.stringify(webhookResponse));
  return;
}

async function onUpdate(event: AWSLambda.CloudFormationCustomResourceUpdateEvent) {
  console.log(JSON.stringify(event));
  return;
}

async function onDelete(deleteEvent: AWSLambda.CloudFormationCustomResourceDeleteEvent) {
  console.log(JSON.stringify(deleteEvent));
  return;
}