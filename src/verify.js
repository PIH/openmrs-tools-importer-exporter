import { loadPatientUuidsFromFile } from "./services/fileService";
import { exportPatient } from "./services/exporterService";

const config = require('../utils/config');

const SUCCESS_DIR = path.join(config.TARGET_DIR, 'successful');

const uuids = loadPatientUuidsFromFile(SUCCESS_DIR);

for (const uuid of uuids) {
  try {
    const patientRecord = await exportPatient(uuid);
  } catch (error) {
    console.error("Failed verify patient ${uuid}:", error);
  }
}
