/**
 * fields.ts — SECTION 1.
 *
 * Re-exports the V3 field spec + its getters from ../FieldSpec.js AS-IS. FieldSpec is the
 * verified seed (it already drives Search/Guard/Quality/adapter); P0 does not edit it. The spec
 * module re-exports it so guidance-generator can render the required-field surface from the same
 * single source the gates read, instead of re-deriving field names.
 *
 * Adapter-spec helpers (getAgentAdapterFieldSpec / getCursorDeliverySpec) are intentionally NOT
 * surfaced here — they already reach consumers through the knowledge facade, and re-exposing them
 * via this barrel would risk colliding with StyleGuide's same-named adapter helper.
 */
export {
  FieldLevel,
  getAllRequiredFieldNames,
  getExpectedFieldNames,
  getExternalAgentRequiredFields,
  getFieldDef,
  getFieldsByLevel,
  getInternalAgentRequiredFields,
  getRequiredFieldNames,
  getRequiredFieldsDescription,
  getSystemInjectedFields,
  STANDARD_CATEGORIES,
  V3_FIELD_SPEC,
  VALID_KINDS,
  VALID_TOPIC_HINTS,
  WHITELISTED_CATEGORIES,
} from '../FieldSpec.js';
