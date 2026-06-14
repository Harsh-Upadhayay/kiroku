package store

// DefaultUserState is the initial sync-state JSON assigned to a newly registered user.
// The exact bytes are part of the client contract (field names, ordering and the schema
// version are all meaningful), so change them only in lockstep with the frontend.
const DefaultUserState = `{"srs_cards_list":[],"active_rows":["hiragana:vowels"],"streak_info":{"current":0,"highest":0,"updatedAt":0},"anki_v3_collection":null,"n5_course_progress":null,"n5_srs_cards":[],"_meta":{"schemaVersion":4,"generatedAt":0}}`
