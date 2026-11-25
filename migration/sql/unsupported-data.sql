-- Data the importer does not migrate. Read by 02-check-source-data.sh (run on the SOURCE database).
-- Format: a "-- item: <label> | <table>" line, followed by one single-line count query for that table.
-- 02 only runs the query when <table> exists (information_schema.tables); otherwise it prints "<label>: table not present".
-- Counts: non-voided rows where the table has a voided column. note and paperrecord_paper_record have no voided column
-- (paper records have a status, but every record counts as data that would be lost), so all rows are counted.
-- item: appointments (scheduling) | appointmentscheduling_appointment
select count(*) from appointmentscheduling_appointment where voided = 0;
-- item: appointments | patient_appointment
select count(*) from patient_appointment where voided = 0;
-- item: conditions | conditions
select count(*) from conditions where voided = 0;
-- item: diagnoses | encounter_diagnosis
select count(*) from encounter_diagnosis where voided = 0;
-- item: notes | note
select count(*) from note;
-- item: paper records | paperrecord_paper_record
select count(*) from paperrecord_paper_record;
