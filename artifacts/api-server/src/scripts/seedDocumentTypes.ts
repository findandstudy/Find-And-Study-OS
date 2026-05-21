import type { Pool } from "pg";

/**
 * Seed the master list of document types into `catalog_options` under
 * category="documents". Idempotent: existing (category, value) rows are
 * skipped. This is the canonical source for selectable document types
 * across the app (per-degree/per-program pickers read from here).
 */
const DOCUMENT_TYPES: Array<{ key: string; label: string }> = [
  { key: "high_school_diploma_translation", label: "HS Diploma (Translation)" },
  { key: "class_10th_ssc_marks_sheet", label: "Class 10 / SSC Marks Sheet" },
  { key: "class_12th_hsc_certificate", label: "Class 12 / HSC Certificate" },
  { key: "class_12th_hsc_marks_sheet", label: "Class 12 / HSC Marks Sheet" },
  { key: "diploma_certificate", label: "Diploma Certificate" },
  { key: "diploma_transcript", label: "Diploma Transcript" },
  { key: "bachelors_certificate", label: "Bachelor's Certificate" },
  { key: "bachelors_transcript", label: "Bachelor's Transcript" },
  { key: "bachelors_provisional_certificate", label: "Bachelor's Provisional Cert." },
  { key: "bachelors_transcript_all_semesters", label: "Bachelor's Transcript (All Sem.)" },
  { key: "masters_certificate", label: "Master's Certificate" },
  { key: "masters_transcript", label: "Master's Transcript" },
  { key: "masters_provisional_certificate", label: "Master's Provisional Cert." },
  { key: "masters_transcript_all_semesters", label: "Master's Transcript (All Sem.)" },
  { key: "passport", label: "Passport" },
  { key: "cv", label: "CV / Resume" },
  { key: "lor", label: "Recommendation Letter" },
  { key: "sop", label: "Statement of Purpose" },
  { key: "essay", label: "Essay" },
  { key: "experience_letters", label: "Experience Letters" },
  { key: "other_certificates_documents", label: "Other Certificates" },
  { key: "ielts_pte_gre_gmat_toefl_duolingo", label: "Language/Test Score" },
  { key: "photo", label: "Photograph" },
  { key: "diploma_recognition", label: "Diploma Recognition" },
  { key: "portfolio", label: "Portfolio" },
  { key: "research_proposal", label: "Research Proposal" },
  { key: "publication_list", label: "Publication List" },
  { key: "writing_sample", label: "Writing Sample" },
  { key: "subject_specific_test_score", label: "Subject-Specific Test Score (SAT/ACT/GRE/GMAT/LSAT/MCAT/BMAT)" },
  { key: "transcript_evaluation_report", label: "Transcript Evaluation Report (WES/ENIC-NARIC)" },
  { key: "medium_of_instruction_letter", label: "Medium of Instruction Letter" },
  { key: "predicted_grades", label: "Predicted Grades (UK)" },
  { key: "gap_year_explanation_letter", label: "Gap Year Explanation Letter" },
  { key: "academic_reference_form", label: "Academic Reference Form" },
  { key: "bank_statement", label: "Bank Statement" },
  { key: "financial_evidence_28_days", label: "Financial Evidence (28 Days, UK)" },
  { key: "financial_documents_3_months", label: "Financial Documents (3 Months, USA)" },
  { key: "gic_certificate", label: "GIC Certificate (Canada SDS)" },
  { key: "sponsor_letter", label: "Sponsor Letter" },
  { key: "affidavit_of_support", label: "Affidavit of Support (I-134/I-864)" },
  { key: "sponsor_id_proof", label: "Sponsor ID / Passport" },
  { key: "sponsor_relationship_proof", label: "Sponsor Relationship Proof" },
  { key: "sponsor_employment_letter", label: "Sponsor Employment Letter" },
  { key: "sponsor_tax_returns", label: "Sponsor Tax Returns" },
  { key: "scholarship_award_letter", label: "Scholarship Award Letter" },
  { key: "proof_of_tuition_payment", label: "Proof of Tuition Payment" },
  { key: "education_loan_approval_letter", label: "Education Loan Approval Letter" },
  { key: "fixed_deposit_receipt", label: "Fixed Deposit Receipt" },
  { key: "medical_examination_report", label: "Medical Examination Report" },
  { key: "hiv_test_certificate", label: "HIV Test Certificate" },
  { key: "tb_test_certificate", label: "TB Test Certificate" },
  { key: "hepatitis_b_test", label: "Hepatitis B Test" },
  { key: "hepatitis_c_test", label: "Hepatitis C Test" },
  { key: "vaccination_record", label: "Vaccination Record" },
  { key: "covid_vaccination_certificate", label: "COVID-19 Vaccination Certificate" },
  { key: "panel_physician_medical_exam", label: "Panel Physician Medical Exam (Canada)" },
  { key: "mental_health_clearance", label: "Mental Health Clearance" },
  { key: "physical_fitness_certificate", label: "Physical Fitness Certificate" },
  { key: "visa_application_form", label: "Visa Application Form" },
  { key: "i20_form", label: "I-20 Form (USA F-1)" },
  { key: "ds160_confirmation", label: "DS-160 Confirmation (USA)" },
  { key: "sevis_fee_receipt", label: "SEVIS I-901 Fee Receipt" },
  { key: "cas_letter", label: "CAS Letter (UK)" },
  { key: "atas_certificate", label: "ATAS Certificate (UK)" },
  { key: "pal_tal_letter", label: "PAL / TAL Letter (Canada)" },
  { key: "letter_of_acceptance_dli", label: "Letter of Acceptance from DLI (Canada)" },
  { key: "biometrics_appointment_receipt", label: "Biometrics Appointment Receipt" },
  { key: "previous_visa_copies", label: "Previous Visa Copies" },
  { key: "visa_refusal_history", label: "Visa Refusal History / Explanation" },
  { key: "travel_history", label: "Travel History" },
  { key: "residence_permit", label: "Residence Permit" },
  { key: "police_clearance_certificate", label: "Police Clearance Certificate" },
  { key: "good_conduct_certificate", label: "Good Conduct Certificate" },
  { key: "birth_certificate", label: "Birth Certificate" },
  { key: "national_id_card", label: "National ID Card" },
  { key: "family_book", label: "Family Book" },
  { key: "marriage_certificate", label: "Marriage Certificate" },
  { key: "name_change_affidavit", label: "Name Change Affidavit" },
  { key: "passport_size_photo_specifications", label: "Passport-Size Photo (Spec-Compliant)" },
  { key: "no_objection_certificate", label: "No Objection Certificate (NOC)" },
  { key: "employer_letter", label: "Employer Letter" },
  { key: "work_experience_certificate", label: "Work Experience Certificate" },
  { key: "internship_certificates", label: "Internship Certificates" },
  { key: "professional_license", label: "Professional License" },
  { key: "business_registration", label: "Business Registration" },
  { key: "military_status_document", label: "Military Status Document (Türkiye)" },
  { key: "yos_score_report", label: "YÖS Score Report (Türkiye)" },
  { key: "sat_score_report", label: "SAT Score Report" },
  { key: "gaokao_score_report", label: "Gaokao Score Report (China)" },
  { key: "abitur_certificate", label: "Abitur Certificate (Germany)" },
  { key: "a_level_certificate", label: "A-Level Certificate (UK)" },
  { key: "ib_diploma", label: "IB Diploma" },
  { key: "olympiad_certificates", label: "Olympiad Certificates" },
  { key: "accommodation_proof", label: "Accommodation Proof" },
  { key: "custodian_declaration", label: "Custodian Declaration" },
  { key: "parental_consent", label: "Parental Consent" },
  { key: "dependents_documents", label: "Dependents' Documents" },
  { key: "ukvi_approved_english_test", label: "UKVI-Approved English Test" },
  { key: "statement_of_finance", label: "Statement of Finance" },
  { key: "personal_statement", label: "Personal Statement" },
  { key: "diversity_statement", label: "Diversity Statement" },
  { key: "ai_usage_declaration", label: "AI Usage Declaration" },
  { key: "gdpr_consent_form", label: "GDPR Consent Form" },
  { key: "fraud_declaration", label: "Fraud Declaration" },
];

export async function seedDocumentTypes(pool: Pool): Promise<void> {
  try {
    let inserted = 0;
    for (let i = 0; i < DOCUMENT_TYPES.length; i++) {
      const { label } = DOCUMENT_TYPES[i];
      const exists = await pool.query(
        `SELECT 1 FROM catalog_options WHERE category = 'documents' AND value = $1 LIMIT 1`,
        [label],
      );
      if (exists.rows.length === 0) {
        await pool.query(
          `INSERT INTO catalog_options (category, value, sort_order, is_active) VALUES ('documents', $1, $2, true)`,
          [label, i],
        );
        inserted++;
      }
    }
    if (inserted > 0) console.log(`[seed] Document types: inserted ${inserted} new rows into catalog_options`);
  } catch (err) {
    console.error("[seed] seedDocumentTypes error:", err);
  }
}
