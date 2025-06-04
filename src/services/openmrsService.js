import axios from 'axios';
import logger from '../utils/logger.js';
import config from '../utils/config.js';
import CONSTANTS from '../utils/constants.js';

// Helper function to get data from OpenMRS API with Basic Authentication
export async function fetchData(url, server = 'SOURCE') {
  try {
    const response = await axios.get(url, { auth: {
        username: server === 'TARGET' ? config.OPENMRS_TARGET_USERNAME : config.OPENMRS_SOURCE_USERNAME,
        password: server === 'TARGET' ? config.OPENMRS_TARGET_PASSWORD : config.OPENMRS_SOURCE_PASSWORD,
      }});
    if (typeof response.data === 'string') {
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
    const response = await axios.get(getUrl, {auth: {
        username: config.OPENMRS_TARGET_USERNAME,
        password: config.OPENMRS_TARGET_PASSWORD,
      }});
    if (response.data?.uuid === uuid) {
      // our script, has currently written, does not overwrite objects that already exist (equality based on uuid)
      logger.info(`Resource already exists: ${getUrl}`);
    }
    if (typeof response?.data === 'string') {
      throw new Error('Bad Response - Unauthenticated?');
    }
  } catch (err) {
    if (err.response && err.response.status === 404) {
      const response = await axios.post(resourceUrl, data, { auth: {
          username: config.OPENMRS_TARGET_USERNAME,
          password: config.OPENMRS_TARGET_PASSWORD,
        } });
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
  await axios.post(`${server === 'TARGET' ? CONSTANTS.TARGET.URLS.GLOBAL_PROPERTY : CONSTANTS.SOURCE.URL.GLOBAL_PROPERTY}/${propertyName}`, {
    value: propertyValue,
  }, { auth: {
      username: server === 'TARGET' ? config.OPENMRS_TARGET_USERNAME : config.OPENMRS_SOURCE_USERNAME,
      password: server === 'TARGET' ? config.OPENMRS_TARGET_PASSWORD : config.OPENMRS_SOURCE_PASSWORD,
    } });
}

export async function getGlobalProperty(propertyName, server = 'TARGET') {
  return fetchData(`${server === 'TARGET' ? CONSTANTS.TARGET.URLS.GLOBAL_PROPERTY : CONSTANTS.SOURCE.URL.GLOBAL_PROPERTY}/${propertyName}`, server);
}