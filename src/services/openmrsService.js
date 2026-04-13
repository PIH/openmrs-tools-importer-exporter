import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import logger from '../utils/logger.js';
import config from '../utils/config.js';
import CONSTANTS from '../utils/constants.js';

const sourceClient = wrapper(axios.create({
  jar: new CookieJar(),
  auth: {
    username: config.OPENMRS_SOURCE_USERNAME,
    password: config.OPENMRS_SOURCE_PASSWORD,
  },
}));

const targetClient = wrapper(axios.create({
  jar: new CookieJar(),
  auth: {
    username: config.OPENMRS_TARGET_USERNAME,
    password: config.OPENMRS_TARGET_PASSWORD,
  },
}));

function getClient(server) {
  return server === 'TARGET' ? targetClient : sourceClient;
}

// Helper function to get data from OpenMRS API with Basic Authentication
export async function fetchData(url, server = 'SOURCE') {
  try {
    const response = await getClient(server).get(url);
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
  }
}

// Try to GET a resource by UUID; if 404, POST it instead
// ie, if a resource already exists, we simply skip and move
export async function postDataIfNotExists(resourceUrl, data, uuid) {
  try {
    const getUrl = `${resourceUrl}/${uuid}`;
    const response = await targetClient.get(getUrl);
    if (response.data?.uuid === uuid) {
      // our script, has currently written, does not overwrite objects that already exist (equality based on uuid)
      logger.info(`Resource already exists: ${getUrl}`);
    }
    if (typeof response?.data === 'string') {
      throw new Error('Bad Response - Unauthenticated?');
    }
  } catch (err) {
    if (err.response && err.response.status === 404) {
      const response = await targetClient.post(resourceUrl, data);
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

export async function setGlobalProperty(propertyName, propertyValue, server = 'TARGET') {
  await getClient(server).post(`${server === 'TARGET' ? CONSTANTS.TARGET.URLS.GLOBAL_PROPERTY : CONSTANTS.SOURCE.URLS.GLOBAL_PROPERTY}/${propertyName}`, {
    value: propertyValue,
  });
}

export async function getGlobalProperty(propertyName, server = 'TARGET') {
  return fetchData(`${server === 'TARGET' ? CONSTANTS.TARGET.URLS.GLOBAL_PROPERTY : CONSTANTS.SOURCE.URLS.GLOBAL_PROPERTY}/${propertyName}`, server);
}