#!/usr/bin/env bash
# Deletes everything a test import created for a set of patients, so the same sample can be imported
# again. FOR TEST DATABASES ONLY: refuses any database whose name doesn't contain "import-test".
#
#   tools/cleanup-import.sh <database> <dir of *_patient.json files, searched recursively> [container]
#
# Patients are identified by the UUIDs in the file names. Never prints data, only row counts deleted.
# Check the result with tools/table-counts.sh (diff against a snapshot taken before the import).
set -euo pipefail
DB=$1; FILES=$2; C=${3:-mysql-openmrs}
[[ "$DB" == *import-test* ]] || { echo "Refusing: $DB is not a test database (name must contain import-test)" >&2; exit 2; }
PW=${MYSQL_PWD:-$(grep -h '^connection.password=' ~/openmrs/*/openmrs-server.properties | head -1 | cut -d= -f2-)}
uuids=$(find "$FILES" -name '*_patient.json' -printf '%f\n' | sed 's/_patient\.json$//' | sort -u)
[ -n "$uuids" ] || { echo "No patient files found in $FILES" >&2; exit 2; }
values=$(echo "$uuids" | sed "s/.*/('&')/" | paste -sd,)

docker exec -i -e MYSQL_PWD="$PW" "$C" mysql -uroot -N "$DB" <<SQL
SET FOREIGN_KEY_CHECKS = 0;
CREATE TEMPORARY TABLE cleanup_uuid (uuid CHAR(38) PRIMARY KEY);
INSERT INTO cleanup_uuid VALUES $values;
CREATE TEMPORARY TABLE cleanup_person (id INT PRIMARY KEY)
  SELECT p.person_id AS id FROM person p JOIN cleanup_uuid u ON u.uuid = p.uuid;
CREATE TEMPORARY TABLE cleanup_encounter (id INT PRIMARY KEY)
  SELECT encounter_id AS id FROM encounter WHERE patient_id IN (SELECT id FROM cleanup_person);
CREATE TEMPORARY TABLE cleanup_visit (id INT PRIMARY KEY)
  SELECT visit_id AS id FROM visit WHERE patient_id IN (SELECT id FROM cleanup_person);
CREATE TEMPORARY TABLE cleanup_order (id INT PRIMARY KEY)
  SELECT order_id AS id FROM orders WHERE patient_id IN (SELECT id FROM cleanup_person);
CREATE TEMPORARY TABLE cleanup_obs (id INT PRIMARY KEY)
  SELECT obs_id AS id FROM obs WHERE person_id IN (SELECT id FROM cleanup_person);
CREATE TEMPORARY TABLE cleanup_program (id INT PRIMARY KEY)
  SELECT patient_program_id AS id FROM patient_program WHERE patient_id IN (SELECT id FROM cleanup_person);
CREATE TEMPORARY TABLE cleanup_allergy (id INT PRIMARY KEY)
  SELECT allergy_id AS id FROM allergy WHERE patient_id IN (SELECT id FROM cleanup_person);
CREATE TEMPORARY TABLE cleanup_name (id INT PRIMARY KEY)
  SELECT person_name_id AS id FROM person_name WHERE person_id IN (SELECT id FROM cleanup_person);

SELECT 'patients found', COUNT(*) FROM cleanup_person;
DELETE FROM obs_reference_range WHERE obs_id IN (SELECT id FROM cleanup_obs);
DELETE FROM obs WHERE obs_id IN (SELECT id FROM cleanup_obs);                     SELECT 'obs', ROW_COUNT();
DELETE FROM drug_order WHERE order_id IN (SELECT id FROM cleanup_order);
DELETE FROM test_order WHERE order_id IN (SELECT id FROM cleanup_order);
DELETE FROM referral_order WHERE order_id IN (SELECT id FROM cleanup_order);
DELETE FROM order_attribute WHERE order_id IN (SELECT id FROM cleanup_order);
DELETE FROM orders WHERE order_id IN (SELECT id FROM cleanup_order);              SELECT 'orders', ROW_COUNT();
DELETE FROM order_group WHERE patient_id IN (SELECT id FROM cleanup_person);
DELETE FROM medication_dispense WHERE patient_id IN (SELECT id FROM cleanup_person); SELECT 'medication_dispense', ROW_COUNT();
DELETE FROM allergy_reaction WHERE allergy_id IN (SELECT id FROM cleanup_allergy);
DELETE FROM allergy WHERE allergy_id IN (SELECT id FROM cleanup_allergy);         SELECT 'allergy', ROW_COUNT();
DELETE FROM encounter_provider WHERE encounter_id IN (SELECT id FROM cleanup_encounter);
DELETE FROM encounter_diagnosis WHERE patient_id IN (SELECT id FROM cleanup_person);
DELETE FROM conditions WHERE patient_id IN (SELECT id FROM cleanup_person);
DELETE FROM note WHERE patient_id IN (SELECT id FROM cleanup_person);
DELETE FROM encounter WHERE encounter_id IN (SELECT id FROM cleanup_encounter);   SELECT 'encounter', ROW_COUNT();
DELETE FROM visit_attribute WHERE visit_id IN (SELECT id FROM cleanup_visit);
DELETE FROM visit WHERE visit_id IN (SELECT id FROM cleanup_visit);               SELECT 'visit', ROW_COUNT();
DELETE FROM patient_state WHERE patient_program_id IN (SELECT id FROM cleanup_program);
DELETE FROM patient_program_attribute WHERE patient_program_id IN (SELECT id FROM cleanup_program);
DELETE FROM patient_program WHERE patient_program_id IN (SELECT id FROM cleanup_program); SELECT 'patient_program', ROW_COUNT();
DELETE FROM patient_identifier WHERE patient_id IN (SELECT id FROM cleanup_person);
DELETE FROM name_phonetics WHERE person_name_id IN (SELECT id FROM cleanup_name);
DELETE FROM person_name WHERE person_id IN (SELECT id FROM cleanup_person);
DELETE FROM person_address WHERE person_id IN (SELECT id FROM cleanup_person);
DELETE FROM person_attribute WHERE person_id IN (SELECT id FROM cleanup_person);
DELETE FROM patient WHERE patient_id IN (SELECT id FROM cleanup_person);
DELETE FROM person WHERE person_id IN (SELECT id FROM cleanup_person);            SELECT 'person', ROW_COUNT();
SET FOREIGN_KEY_CHECKS = 1;
SQL
