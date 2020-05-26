/* istanbul ignore file */

// eslint-disable-next-line import/no-extraneous-dependencies
import * as aws from 'aws-sdk';
import * as https from 'https';

let client: aws.SecretsManager;

interface GitHubResponse {
  readonly id: string;
}

function secretsManager() {
  if (!client) { client = new aws.SecretsManager(); }
  return client;
}

function defaultLogger(fmt: string, ...args: any[]) {
  // tslint:disable-next-line: no-console
  console.log(fmt, ...args);
}

interface GitHubApiRequest {
  readonly path: string;
  readonly token: string;
  readonly method: string;
  readonly data?: any;
}

function sendGitHubApiRequest<T>(request: GitHubApiRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const options: https.RequestOptions = {
      host: 'api.github.com',
      port: 443,
      method: request.method,
      path: request.path,
      headers: {
        Authorization: `token ${request.token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'XaasKit CDK GitHub Webhook Provider'
      }
    };
    const data = request.data && JSON.stringify(request.data);
    if (data) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = data.length;
    }
    const req = https.request(options, res => {
      if (res.statusCode) {
        if (res.statusCode == 204) { // No Content
          resolve(undefined);
        } 
        if ((res.statusCode < 200 || res.statusCode >= 300)) {
          new Error(`statusCode=${res.statusCode};statusMessage=${res.statusMessage}`);
        }
      }      
      let body: any[] = [];
      res.on('data', function (chunk) {
        body.push(chunk);
      });
      res.on('end', function () {
        try {
          resolve(JSON.parse(Buffer.concat(body).toString()));
        } catch (e) {
          reject(e);
        }
      });
    });
    if (data) {
      req.write(JSON.stringify(request.data))
    }
    req.end();
  });
}

interface GitHubRequest {
  readonly token: string;
}

interface GitHubResponse {
  readonly id: string;
}

interface RepositoryWebhookResponse extends GitHubResponse {
  readonly url: string;
}

interface RepositoryRequest extends GitHubRequest {
  readonly owner: string;
  readonly repository: string;
}

interface RepositoryWebhookRequest extends RepositoryRequest {
  readonly url: string;
  readonly events: string[];
  readonly active?: boolean;
}

interface CreateWebhookRequest extends RepositoryWebhookRequest { }

interface UpdateWebhookRequest extends RepositoryWebhookRequest { id: string; }

interface DeleteWebhookRequest extends RepositoryRequest { id: string; }

// GitHub
function createGitHubWebhook(request: CreateWebhookRequest) {
  return sendGitHubApiRequest<RepositoryWebhookResponse>({
    path: `/repos/${request.owner}/${request.repository}/hooks`,
    method: 'POST',
    token: request.token,
    data: {
      name: 'web',
      config: {
        url: request.url,
        content_type: 'json',
      },
      active: request.active ?? true,
      events: request.events,
    }
  });
}

function updateGitHubWebhook(request: UpdateWebhookRequest) {
  return sendGitHubApiRequest({
    path: `/repos/${request.owner}/${request.repository}/hooks/${request.id}`,
    method: 'PATCH',
    token: request.token,
    data: {
      name: 'web',
      config: {
        url: request.url,
        content_type: 'json',
      },
      active: request.active ?? true,
      events: request.events,
    }
  });
}

function deleteGitHubWebhook(request: DeleteWebhookRequest) {
  return sendGitHubApiRequest({
    path: `/repos/${request.owner}/${request.repository}/hooks/${request.id}`,
    method: 'DELETE',
    token: request.token,
  });
}

// GitHub Token
async function resolveGitHubToken(explicitToken: string, tokenSecretId) {
  if (explicitToken) {
    return explicitToken;
  }
  const response = await secretsManager().getSecretValue({ SecretId: tokenSecretId}).promise();
  if (!response.SecretString) {
    throw new Error(`GitHub token secret with id '${tokenSecretId}' not found! Please create and set the secret '${tokenSecretId}' with a GitHub OAuth token.`);
  }
  return response.SecretString;
}

export const external = {
  log: defaultLogger,
  resolveGitHubToken,
  createGitHubWebhook,
  updateGitHubWebhook,
  deleteGitHubWebhook,
};