
-- simple script to test the counts of all key OpenMRS domain objects
-- can be used to sanity check a migration
-- not currently implemented: appointments (either type), bed assignments, paper records, provider management fields, queues
-- also, nothing except patients, visits, encounters and obs have been fully tested yet, since the importer/exporter doesn't handle anything else properly yet
-- and, of course, this *only* tests counts, doesn't necessarily mean that the *data* is consistent between tables
select count(*) into @allergies from allergy a, patient p where a.patient_id = p.patient_id and a.voided = 0 and p.voided = 0;
select count(*) into @allergy_reactions from allergy a, allergy_reaction ae, patient p where a.patient_id = p.patient_id and ae.allergy_id = a.allergy_id and p.voided = 0 and a.voided = 0;  -- no voided on allergy reaction?
select count(*) into @conditions from conditions c, patient p where c.patient_id = p.patient_id and c.voided = 0 and p.voided = 0;
select count(*) into @drug_orders from drug_order do, orders o, patient p where do.order_id = o.order_id and o.patient_id = p.patient_id and o.voided = 0 and p.voided = 0;
select count(*) into @encounter_diagnoses from encounter_diagnosis ed, encounter e, patient p where p.patient_id = e.patient_id and ed.encounter_id = e.encounter_id and p.voided = 0 and e.voided = 0 and ed.voided = 0;
select count(*) into @encounter_providers from encounter_provider ep, encounter e, patient p where p.patient_id = e.patient_id and ep.encounter_id = e.encounter_id and p.voided = 0 and e.voided = 0 and ep.voided = 0;
select count(*) into @encounters from patient p, encounter e where p.patient_id = e.patient_id and p.voided=0 and e.voided=0;
select count(*) into @medication_dispenses from medication_dispense md, patient p where md.patient_id = p.patient_id and md.voided = 0 and p.voided = 0;
select count(*) into @notes from note n;  -- no voided on note?
select count(*) into @obs from patient p, obs o, encounter e where o.encounter_id=e.encounter_id and e.patient_id=p.patient_id and p.voided=0 and o.voided=0 and e.voided=0;
select count(*) into @order_attributes from order_attribute oa, orders o, patient p where oa.order_id = o.order_id and o.patient_id = p. patient_id and oa.voided =0 and  o.voided = 0 and p.voided = 0;
select count(*) into @orders from orders o, patient p where o.patient_id = p. patient_id and o.voided = 0 and p.voided = 0;
select count(*) into @patients from patient where voided = 0;
select count(*) into @patient_identifiers from patient_identifier pi, patient p where pi.patient_id = p.patient_id and pi.voided = 0 and p.voided = 0;
select count(*) into @patient_programs from patient_program pp, patient p where pp.patient_id = p.patient_id and pp.voided = 0 and p.voided = 0;
select count(*) into @patient_states from patient_program pp, patient_state ps, patient p where ps.patient_program_id = pp.patient_program_id and pp.patient_id = p.patient_id and pp.voided = 0 and ps.voided = 0 and p.voided = 0;
select count(*) into @person_addresses from person p, person_address pa where p.person_id = pa.person_id and p.voided = 0 and pa.voided = 0;
select count(*) into @person_attributes from person p, person_attribute pa where p.person_id = pa.person_id and p.voided = 0 and pa.voided = 0;
select count(*) into @person_names from person p, person_name pn where p.person_id = pn.person_id and p.voided = 0 and pn.voided = 0;
select count(*) into @persons from person where voided = 0;
select count(*) into @providers from provider pr, person p where pr.person_id = p.person_id and pr.retired = 0 and p.voided = 0;
select count(*) into @radiology_orders from emr_radiology_order ro, orders o, patient p where ro.order_id = o.order_id and o.patient_id = p.patient_id and o.voided = 0 and p.voided = 0;
select count(*) into @referral_orders from referral_order ro, orders o, patient p where ro.order_id = o.order_id and o.patient_id = p.patient_id and o.voided = 0 and p.voided = 0;
select count(*) into @relationships from relationship r, person p1, person p2 where r.person_a = p1.person_id and r.person_b = p2.person_id and p1.voided = 0 and p2.voided = 0 and r.voided = 0;
select count(*) into @test_orders from test_order t, orders o, patient p where t.order_id = o.order_id and o.patient_id = p.patient_id and o.voided = 0 and p.voided = 0;
select count(*) into @users from users u where u.retired = 0;  -- we may need to tweak this based on how we import users
select count(*) into @user_properties from user_property up, users u where up.user_id = u.user_id and u.retired = 0;
select count(*) into @user_roles from user_role ur, users u where ur.user_id = u.user_id and u.retired = 0;
select count(*) into @visits from visit v, patient p where v.patient_id = p.patient_id and v.voided = 0 and p.voided =0;
select count(*) into @visit_attributes from visit_attribute va, visit v, patient p where va.visit_id = v.visit_id and v.patient_id = p.patient_id and va.voided = 0 and v.voided = 0 and p.voided =0;

SELECT CONCAT(RPAD('ALLERGIES', 25, ' '), ' = ', @allergies)
UNION ALL
SELECT CONCAT(RPAD('ALLERGY REACTIONS', 25, ' '), ' = ', @allergy_reactions)
UNION ALL
SELECT CONCAT(RPAD('CONDITIONS', 25, ' '), ' = ', @conditions)
UNION ALL
SELECT CONCAT(RPAD('DRUG ORDERS', 25, ' '), ' = ', @drug_orders)
UNION ALL
SELECT CONCAT(RPAD('ENCOUNTERS', 25, ' '), ' = ', @encounters)
UNION ALL
SELECT CONCAT(RPAD('ENCOUNTER DIAGNOSES', 25, ' '), ' = ', @encounter_diagnoses)
UNION ALL
SELECT CONCAT(RPAD('ENCOUNTER PROVIDERS', 25, ' '), ' = ', @encounter_providers)
UNION ALL
SELECT CONCAT(RPAD('MEDICATION DISPENSES', 25, ' '), ' = ', @medication_dispenses)
UNION ALL
SELECT CONCAT(RPAD('NOTES', 25, ' '), ' = ', @notes)
UNION ALL
SELECT CONCAT(RPAD('OBS', 25, ' '), ' = ', @obs)
UNION ALL
SELECT CONCAT(RPAD('ORDER ATTRIBUTES', 25, ' '), ' = ', @order_attributes)
UNION ALL
SELECT CONCAT(RPAD('ORDERS', 25, ' '), ' = ', @orders)
UNION ALL
SELECT CONCAT(RPAD('PATIENTS', 25, ' '), ' = ', @patients)
UNION ALL
SELECT CONCAT(RPAD('PATIENT IDENTIFIERS', 25, ' '), ' = ', @patient_identifiers)
UNION ALL
SELECT CONCAT(RPAD('PATIENT PROGRAMS', 25, ' '), ' = ', @patient_programs)
UNION ALL
SELECT CONCAT(RPAD('PATIENT STATES', 25, ' '), ' = ', @patient_states)
UNION ALL
SELECT CONCAT(RPAD('PERSON ADDRESSES', 25, ' '), ' = ', @person_addresses)
UNION ALL
SELECT CONCAT(RPAD('PERSON ATTRIBUTES', 25, ' '), ' = ', @person_attributes)
UNION ALL
SELECT CONCAT(RPAD('PERSON NAMES', 25, ' '), ' = ', @person_names)
UNION ALL
SELECT CONCAT(RPAD('PERSONS', 25, ' '), ' = ', @persons) AS pretty_output
UNION ALL
SELECT CONCAT(RPAD('PROVIDERS', 25, ' '), ' = ', @providers) AS pretty_output
UNION ALL
SELECT CONCAT(RPAD('RADIOLOGY ORDERS', 25, ' '), ' = ', @radiology_orders)
UNION ALL
SELECT CONCAT(RPAD('REFERRAL ORDERS', 25, ' '), ' = ', @referral_orders)
UNION ALL
SELECT CONCAT(RPAD('RELATIONSHIPS', 25, ' '), ' = ', @relationships)
UNION ALL
SELECT CONCAT(RPAD('TEST ORDERS', 25, ' '), ' = ', @test_orders)
UNION ALL
SELECT CONCAT(RPAD('USERS', 25, ' '), ' = ', @users)
UNION ALL
SELECT CONCAT(RPAD('USER PROPERTIES', 25, ' '), ' = ', @user_properties)
UNION ALL
SELECT CONCAT(RPAD('USER ROLES', 25, ' '), ' = ', @user_roles)
UNION ALL
SELECT CONCAT(RPAD('VISITS', 25, ' '), ' = ', @visits)
UNION ALL
SELECT CONCAT(RPAD('VISIT ATTRIBUTES', 25, ' '), ' = ', @visit_attributes);