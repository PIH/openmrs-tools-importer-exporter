import axios from 'axios';
import { HttpCookieAgent, HttpsCookieAgent } from 'http-cookie-agent/http';
import { CookieJar } from 'tough-cookie';
import logger from '../utils/logger.js';
import config from '../utils/config.js';
import CONSTANTS from '../utils/constants.js';
import { recordRequest } from '../utils/metrics.js';

// One cookie-aware agent per client, reused for every request, with keep-alive so connections are
// reused. (axios-cookiejar-support's wrapper created a new agent, and so a new connection, per request.)
function createClient(username, password) {
  const jar = new CookieJar();
  const agentOptions = { cookies: { jar }, keepAlive: true, maxSockets: 256 };
  return axios.create({
    httpAgent: new HttpCookieAgent(agentOptions),
    httpsAgent: new HttpsCookieAgent(agentOptions),
    auth: { username, password },
    // So a hung server fails the request (and the patient can be retried) instead of waiting forever
    timeout: Number(config.REQUEST_TIMEOUT_MS) || 120000,
  });
}

const sourceClient = createClient(config.OPENMRS_SOURCE_USERNAME, config.OPENMRS_SOURCE_PASSWORD);
const targetClient = createClient(config.OPENMRS_TARGET_USERNAME, config.OPENMRS_TARGET_PASSWORD);

function getClient(server) {
  return server === 'TARGET' ? targetClient : sourceClient;
}

// Runs a request, recording its duration by resource type; a 404 counts as a normal outcome (it's how
// postDataIfNotExists finds out a resource doesn't exist yet)
async function timed(method, url, request) {
  const started = performance.now();
  let ok = false;
  try {
    const response = await request();
    ok = true;
    return response;
  } catch (err) {
    ok = err.response?.status === 404;
    throw err;
  } finally {
    recordRequest(method, url, performance.now() - started, ok);
  }
}

// Helper function to get data from OpenMRS REST WS API with Basic Authentication
export async function fetchData(url, server = 'SOURCE') {
  const started = performance.now();
  let ok = false;
  try {
    const response = await getClient(server).get(url);
    ok = true;
    if (typeof response.data === 'string' && response.status !== 204) {  // 204 = no content, is what the allergies endpoint returns if no allergies
      throw new Error('Bad Response - Unauthenticated?');
    }
    return response.data;
  } catch (error) {
    logger.error("Error fetching data from OpenMRS: ", error);
    if (error.response?.data?.error?.detail) {
      logger.error(error.response.data.error.detail);
    }
    throw error;
  } finally {
    recordRequest('GET', url, performance.now() - started, ok);
  }
}

// Try to GET a resource by UUID; if 404, POST it instead
// ie, if a resource already exists, we simply skip and move
export async function postDataIfNotExists(resourceUrl, data, uuid) {
  try {
    const getUrl = `${resourceUrl}/${uuid}`;
    const response = await timed('GET', getUrl, () => targetClient.get(getUrl));
    if (response.data?.uuid === uuid) {
      // our script, has currently written, does not overwrite objects that already exist (equality based on uuid)
      logger.info(`Resource already exists: ${getUrl}`);
    }
    if (typeof response?.data === 'string') {
      throw new Error('Bad Response - Unauthenticated?');
    }
  } catch (err) {
    if (err.response && err.response.status === 404) {
      const response = await timed('POST', resourceUrl, () => targetClient.post(resourceUrl, data));
      if (response.status !== 201) {
        throw new Error(`Failed to create resource at ${resourceUrl}, status code: ${response.status}`);
      }
      else {
        logger.info(`Created new resource at ${resourceUrl}`);
      }
    } else {
      throw err;
    }
  }
}


export async function postData(resourceUrl, data) {
  const response = await targetClient.post(resourceUrl, data);
  return response.data;
}

export async function setGlobalProperty(propertyName, propertyValue, server = 'TARGET') {
  await getClient(server).post(`${server === 'TARGET' ? CONSTANTS.TARGET.URLS.GLOBAL_PROPERTY : CONSTANTS.SOURCE.URLS.GLOBAL_PROPERTY}/${propertyName}`, {
    value: propertyValue,
  });
}

export async function getGlobalProperty(propertyName, server = 'TARGET') {
  return fetchData(`${server === 'TARGET' ? CONSTANTS.TARGET.URLS.GLOBAL_PROPERTY : CONSTANTS.SOURCE.URLS.GLOBAL_PROPERTY}/${propertyName}`, server);
}