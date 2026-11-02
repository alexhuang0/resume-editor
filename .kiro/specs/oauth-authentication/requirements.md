# Requirements Document

## Introduction

This feature adds optional Google sign-in and cloud sync of the resume library to the editor, which has had no backend, no accounts, and no Supabase dependency until now. The purpose of signing in is multi-device editing: a signed-in user edits on one machine and sees the same variants and item bank on another.

The app stays local-first. Running with no account behaves exactly as it does today, backed by the existing zustand `persist` middleware under the `resume-editor:v1` localStorage key. Signing in turns sync on and merges the existing local content into the cloud library; signing out returns the app to the anonymous path.

The storage model is deliberately coarse: one row per user holding the whole library as a single JSONB document, synchronized by one upsert and one fetch, resolved last-write-wins. Per-row relational tables for variants, sections, items, and bullets were considered and rejected. The cloud payload mirrors the shape the store already persists (`variants`, `currentVariantId`, `bank`) plus a version stamp, so the existing pure migration function keeps owning schema upgrades for both the localStorage path and the cloud path.

The user performs the external setup (Supabase project, Google Cloud OAuth client, redirect URLs, table and security policies) and needs written instructions, so documented setup and environment-variable handling are part of this feature. Reversing the "no cloud sync, no accounts, no multi-device" exclusion recorded in `CLAUDE.md` is also in scope.

Out of scope: version history, sharing a library between two different accounts, real-time collaborative editing, server-side conflict merging, any OAuth provider other than Google, and syncing ephemeral UI state.

## Glossary

- **Resume_Editor**: The client-side React + TypeScript single-page application in this repository.
- **Local_Library**: The library state held in `localStorage` under the key `resume-editor:v1` by the zustand `persist` middleware on `src/store/resumeStore.ts`.
- **Persisted_Slice**: The exact object returned by the `partialize` option of `src/store/resumeStore.ts`, containing the keys `variants`, `currentVariantId`, and `bank`.
- **UI_State**: The state held in `src/store/uiStore.ts` — focus, collapsed sections, toast queue, pane order, and minimized panes — which is excluded from the Persisted_Slice by design.
- **Library_Payload**: The JSON document exchanged with the Cloud_Library_Row, consisting of the three Persisted_Slice keys plus the key `payloadVersion`.
- **Payload_Version**: The integer value of the `payloadVersion` key of a Library_Payload, equal to the `version` option of the zustand `persist` configuration in `src/store/resumeStore.ts`, which is `3` at the time of writing.
- **Library_Migrator**: The pure function `migratePersistedLibrary(persisted, fromVersion)` exported from `src/store/migrations.ts`.
- **Auth_Service**: The hosted Supabase authentication service reached through the Supabase JavaScript client.
- **Google_Provider**: The Google OAuth 2.0 identity provider configured in the Auth_Service.
- **Session**: The Supabase authentication session identifying one signed-in user, including the access token, the refresh token, and the user identifier.
- **Signed_In_State**: The state of the Resume_Editor while a valid Session is present.
- **Anonymous_State**: The state of the Resume_Editor while no valid Session is present.
- **Cloud_Library_Row**: The single database row in the Supabase table that stores one user's Library_Payload, keyed by the user identifier, carrying an `updated_at` timestamp maintained by the database.
- **Sync_Engine**: The Resume_Editor module that reads and writes the Cloud_Library_Row and mediates between the Cloud_Library_Row and the Local_Library.
- **Last_Synced_Marker**: The `updated_at` value of the Cloud_Library_Row recorded locally by the Sync_Engine at the end of the most recent successful read or write for the current user.
- **Cloud_Newer_Condition**: The condition in which the `updated_at` value of the Cloud_Library_Row is greater than the Last_Synced_Marker.
- **Conflict_Prompt**: The modal dialog the Sync_Engine presents on the Cloud_Newer_Condition, offering the three choices "Keep local", "Use cloud", and "Download backup".
- **Merge_Operation**: The combination of a Library_Payload and the Local_Library into one library by taking the union of `variants` entries and the union of `bank` entries keyed on each entry's `id` field.
- **Access_Policy**: The set of Supabase row-level security policies on the table holding Cloud_Library_Row records.
- **Supabase_Env_Vars**: The two Vite environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- **Local_Only_Mode**: The operating mode in which the Resume_Editor runs the Anonymous_State, offers no sign-in control, and performs no network request to the Auth_Service or the Cloud_Library_Row.
- **Setup_Guide**: The written manual-setup section added to the repository documentation covering Supabase project creation, Google Cloud OAuth client creation, redirect URL configuration, and the table and Access_Policy SQL.
- **Env_Example_File**: The file `.env.example` at the repository root listing the Supabase_Env_Vars with placeholder values.
- **Test_Suite**: The Vitest test suite for this project, invoked by `npm test`.

## Requirements

### Requirement 1

**User Story:** As a user who does not want an account, I want the editor to work exactly as it does today, so that adding sign-in costs me nothing.

#### Acceptance Criteria

1. WHILE the Resume_Editor is in the Anonymous_State, THE Resume_Editor SHALL read the library from the Local_Library and write every content mutation to the Local_Library.
2. WHILE the Resume_Editor is in the Anonymous_State, THE Sync_Engine SHALL perform zero network requests to the Cloud_Library_Row.
3. WHILE the Resume_Editor is in the Anonymous_State, THE Resume_Editor SHALL make every editing, import, and export action available that is available before this feature is added.
4. THE Resume_Editor SHALL keep the `name` option of the zustand `persist` configuration equal to `resume-editor:v1`.
5. THE Resume_Editor SHALL keep the Persisted_Slice limited to the keys `variants`, `currentVariantId`, and `bank`.
6. WHEN the Resume_Editor starts with no Session present, THE Resume_Editor SHALL render the editor with the Local_Library content before issuing any request to the Auth_Service.

### Requirement 2

**User Story:** As a user with two machines, I want to sign in with my Google account, so that I can turn on sync for my library.

#### Acceptance Criteria

1. WHILE the Resume_Editor is in the Anonymous_State and the Supabase_Env_Vars hold non-empty values, THE Resume_Editor SHALL display a sign-in control.
2. WHEN the user activates the sign-in control, THE Resume_Editor SHALL start an OAuth authorization flow against the Auth_Service using the Google_Provider.
3. THE Resume_Editor SHALL offer the Google_Provider as the only identity provider.
4. WHEN the Auth_Service returns a valid Session, THE Resume_Editor SHALL enter the Signed_In_State.
5. WHILE the Resume_Editor is in the Signed_In_State, THE Resume_Editor SHALL display the signed-in user's email address.
6. WHILE the Resume_Editor is in the Signed_In_State, THE Resume_Editor SHALL display a sign-out control.
7. WHEN the user activates the sign-out control, THE Resume_Editor SHALL end the Session and enter the Anonymous_State.
8. WHEN the user activates the sign-out control, THE Resume_Editor SHALL retain the Local_Library content unchanged.
9. IF the Auth_Service returns an authorization error, THEN THE Resume_Editor SHALL remain in the Anonymous_State and display the error reason in a toast.

### Requirement 3

**User Story:** As a signed-in user, I want to stay signed in when I reload the page, so that I do not re-authorize on every visit.

#### Acceptance Criteria

1. WHEN the Resume_Editor starts and a stored Session is present, THE Resume_Editor SHALL restore that Session and enter the Signed_In_State without user interaction.
2. WHEN the access token of the current Session expires, THE Resume_Editor SHALL refresh the Session through the Auth_Service using the stored refresh token.
3. WHEN a Session refresh succeeds, THE Resume_Editor SHALL remain in the Signed_In_State.
4. IF a stored Session fails to restore or fails to refresh, THEN THE Resume_Editor SHALL enter the Anonymous_State and display a sign-in control.
5. IF a stored Session fails to restore or fails to refresh, THEN THE Resume_Editor SHALL keep serving the Local_Library content.
6. WHILE the Resume_Editor is resolving a stored Session at startup, THE Resume_Editor SHALL render the editor with the Local_Library content.

### Requirement 4

**User Story:** As a user signing in for the first time, I want the variants I already built locally to end up in my cloud library, so that signing in does not strand my work.

#### Acceptance Criteria

1. WHEN the Resume_Editor enters the Signed_In_State and no Cloud_Library_Row exists for the signed-in user, THE Sync_Engine SHALL write a Library_Payload built from the Local_Library to a new Cloud_Library_Row.
2. WHEN the Resume_Editor enters the Signed_In_State, a Cloud_Library_Row exists for the signed-in user, and the Local_Library holds at least one variant absent from that Cloud_Library_Row, THE Sync_Engine SHALL apply the Merge_Operation and write the merged library to both the Cloud_Library_Row and the Local_Library.
3. WHERE the Merge_Operation encounters a `variants` entry or a `bank` entry whose `id` value is present in both the Library_Payload and the Local_Library, THE Sync_Engine SHALL keep the entry from the Library_Payload.
4. WHEN the Merge_Operation completes, THE Sync_Engine SHALL set `currentVariantId` to the value from the Library_Payload where that value identifies a variant in the merged library, and to the `id` of the first merged variant otherwise.
5. WHEN a write to the Cloud_Library_Row succeeds, THE Sync_Engine SHALL set the Last_Synced_Marker to the `updated_at` value returned by that write.
6. THE Sync_Engine SHALL exclude every key of UI_State from the Library_Payload.

### Requirement 5

**User Story:** As a signed-in user editing on two machines, I want to be told when the cloud copy is newer than my last sync, so that I choose which copy survives instead of losing one silently.

#### Acceptance Criteria

1. WHEN the Resume_Editor enters the Signed_In_State, THE Sync_Engine SHALL read the Cloud_Library_Row for the signed-in user.
2. WHEN the Sync_Engine reads the Cloud_Library_Row, THE Sync_Engine SHALL compare the row's `updated_at` value against the Last_Synced_Marker.
3. IF the Cloud_Newer_Condition holds, THEN THE Sync_Engine SHALL present the Conflict_Prompt and defer every write to the Cloud_Library_Row until the user selects a choice.
4. WHEN the user selects "Keep local" in the Conflict_Prompt, THE Sync_Engine SHALL write a Library_Payload built from the Local_Library to the Cloud_Library_Row and set the Last_Synced_Marker to the `updated_at` value returned by that write.
5. WHEN the user selects "Use cloud" in the Conflict_Prompt, THE Sync_Engine SHALL replace the Local_Library with the content of the fetched Library_Payload and set the Last_Synced_Marker to the `updated_at` value of the fetched Cloud_Library_Row.
6. WHEN the user selects "Download backup" in the Conflict_Prompt, THE Resume_Editor SHALL download the Local_Library as a library JSON file using the existing library export path and SHALL present the Conflict_Prompt again.
7. WHILE the Conflict_Prompt is displayed, THE Sync_Engine SHALL leave both the Local_Library and the Cloud_Library_Row unmodified.
8. WHILE the Resume_Editor is in the Signed_In_State and no Conflict_Prompt is pending, WHEN the Persisted_Slice changes, THE Sync_Engine SHALL write a Library_Payload built from the Local_Library to the Cloud_Library_Row.
9. THE Sync_Engine SHALL resolve each write to the Cloud_Library_Row as a single upsert keyed on the signed-in user's identifier, so that the most recent write determines the stored content.

### Requirement 6

**User Story:** As a user whose cloud copy was written by an older build of the app, I want it upgraded on read, so that one stale machine does not corrupt my library.

#### Acceptance Criteria

1. THE Sync_Engine SHALL include the Payload_Version in every Library_Payload written to the Cloud_Library_Row.
2. WHEN the Sync_Engine reads a Library_Payload whose Payload_Version is lower than the current Payload_Version, THE Sync_Engine SHALL pass the payload and its Payload_Version to the Library_Migrator and use the returned value as the fetched library.
3. THE Sync_Engine SHALL obtain schema upgrades from the Library_Migrator rather than from migration logic of its own.
4. IF the Sync_Engine reads a Library_Payload whose Payload_Version is higher than the current Payload_Version, THEN THE Sync_Engine SHALL leave the Local_Library unmodified, suppress every write to the Cloud_Library_Row for the remainder of the session, and display a toast stating that the cloud library requires a newer version of the app.
5. IF the Sync_Engine reads a Library_Payload that fails validation against the library schema, THEN THE Sync_Engine SHALL leave the Local_Library unmodified and display a toast reporting the invalid cloud library.

### Requirement 7

**User Story:** As a user storing my resume in a hosted database, I want my row readable and writable only by me, so that other accounts cannot reach my data.

#### Acceptance Criteria

1. THE Cloud_Library_Row SHALL hold one row per user, keyed on the user identifier issued by the Auth_Service, with the library stored in a single JSONB column.
2. THE Access_Policy SHALL grant a signed-in user read access to rows whose user identifier equals that user's identifier.
3. THE Access_Policy SHALL grant a signed-in user insert and update access to rows whose user identifier equals that user's identifier.
4. WHEN a signed-in user requests a row whose user identifier differs from that user's identifier, THE Access_Policy SHALL return zero rows.
5. WHEN a signed-in user attempts to insert or update a row whose user identifier differs from that user's identifier, THE Access_Policy SHALL reject the write.
6. WHEN a request carries no valid Session, THE Access_Policy SHALL reject the request.
7. THE Cloud_Library_Row SHALL carry an `updated_at` timestamp set by the database on every insert and update.

### Requirement 8

**User Story:** As a developer or a user who cloned the repository without credentials, I want the app to run anyway, so that a missing configuration value is not a crash.

#### Acceptance Criteria

1. IF either of the Supabase_Env_Vars is absent or holds an empty value at startup, THEN THE Resume_Editor SHALL enter Local_Only_Mode and render the editor.
2. IF the value of `VITE_SUPABASE_URL` fails to parse as an absolute HTTPS URL, THEN THE Resume_Editor SHALL enter Local_Only_Mode and render the editor.
3. WHILE the Resume_Editor is in Local_Only_Mode, THE Resume_Editor SHALL display an indication that cloud sync is unconfigured.
4. WHILE the Resume_Editor is in Local_Only_Mode, THE Resume_Editor SHALL construct no Supabase client and issue no request to the Auth_Service.
5. THE Resume_Editor SHALL read Supabase configuration exclusively from the Supabase_Env_Vars.
6. THE Resume_Editor SHALL contain no Supabase project URL, key, or Google OAuth credential as a literal value in any committed source file.

### Requirement 9

**User Story:** As a signed-in user on a flaky connection, I want to keep editing, so that a dropped network does not block my work or lose an edit.

#### Acceptance Criteria

1. IF a read of the Cloud_Library_Row fails with a network error, THEN THE Resume_Editor SHALL continue serving the Local_Library, display a toast reporting the failed sync, and remain in the Signed_In_State.
2. IF a write to the Cloud_Library_Row fails with a network error, THEN THE Sync_Engine SHALL leave the Last_Synced_Marker unchanged and retain the pending Library_Payload for a later write attempt.
3. WHILE a write to the Cloud_Library_Row is pending or failing, THE Resume_Editor SHALL accept every content mutation and write it to the Local_Library.
4. WHEN a write to the Cloud_Library_Row fails and a subsequent write for the same user succeeds, THE Sync_Engine SHALL write the Library_Payload built from the then-current Local_Library.
5. WHILE the Resume_Editor is in the Signed_In_State, THE Resume_Editor SHALL display the current sync status as one of synced, pending, or failed.
6. IF a request to the Cloud_Library_Row fails because the Session is unauthorized, THEN THE Resume_Editor SHALL enter the Anonymous_State, display a toast requesting re-authorization, and retain the Local_Library content unchanged.

### Requirement 10

**User Story:** As the person who owns the Supabase and Google Cloud accounts, I want written setup instructions, so that I can provision the backend myself without guessing.

#### Acceptance Criteria

1. THE Setup_Guide SHALL state the steps to create a Supabase project and to locate the project URL and the anonymous key.
2. THE Setup_Guide SHALL state the steps to create a Google Cloud OAuth 2.0 client and to enter the client id and client secret into the Auth_Service Google_Provider configuration.
3. THE Setup_Guide SHALL state the redirect URL values to register for the local development origin and for a deployed origin, including the Auth_Service callback URL to register in the Google Cloud OAuth client.
4. THE Setup_Guide SHALL state the SQL that creates the table holding Cloud_Library_Row records, enables row-level security on that table, and creates the Access_Policy.
5. THE Setup_Guide SHALL state that the Supabase_Env_Vars belong in a local `.env` file created by copying the Env_Example_File.
6. THE Env_Example_File SHALL list both Supabase_Env_Vars with placeholder values and SHALL contain no real credential.
7. THE repository `.gitignore` SHALL match `.env` and `.env.local` so that a local environment file stays uncommitted.
8. THE Setup_Guide SHALL state that the anonymous key is safe to expose in the client bundle and that the Google client secret belongs in the Auth_Service configuration rather than in the repository.

### Requirement 11

**User Story:** As a maintainer returning to this repository, I want the project documentation to reflect that cloud sync now exists, so that the guidance does not contradict the code.

#### Acceptance Criteria

1. THE `CLAUDE.md` out-of-scope list SHALL omit cloud sync, accounts, and multi-device from the excluded items.
2. THE `CLAUDE.md` out-of-scope list SHALL continue to exclude version history, an in-browser LaTeX engine, in-app AI tailoring, cover letters, multi-page layouts, and themes.
3. THE `CLAUDE.md` architecture section SHALL describe the Sync_Engine, the one-row-per-user JSONB storage model, the last-write-wins resolution, and the Conflict_Prompt.
4. THE `CLAUDE.md` architecture section SHALL state that UI_State stays outside the Library_Payload.
5. THE `CLAUDE.md` commands section SHALL state that the Supabase_Env_Vars are required for sign-in and that their absence yields Local_Only_Mode.

### Requirement 12

**User Story:** As a maintainer, I want the sync and merge logic covered by automated tests, so that a conflict or migration bug is caught before it reaches my library.

#### Acceptance Criteria

1. THE Sync_Engine SHALL expose the Library_Payload construction, the Merge_Operation, the Cloud_Newer_Condition evaluation, and the Payload_Version handling as pure functions callable without a network connection or a DOM.
2. THE Test_Suite SHALL include a test asserting that a Library_Payload built from a library contains exactly the keys `variants`, `currentVariantId`, `bank`, and `payloadVersion`.
3. THE Test_Suite SHALL include a test asserting that a Library_Payload contains no key of UI_State, including `collapsed`, `paneOrder`, and `minimizedPanes`.
4. THE Test_Suite SHALL include a property-based test asserting that the Merge_Operation yields a library whose `variants` identifiers equal the union of the input identifiers and whose entries are free of duplicate identifiers.
5. THE Test_Suite SHALL include a test asserting that the Merge_Operation resolves an identifier present on both sides to the Library_Payload entry.
6. THE Test_Suite SHALL include a test asserting that a Library_Payload with a Payload_Version of `2` is upgraded through the Library_Migrator to the current Payload_Version.
7. THE Test_Suite SHALL include a test asserting that a Library_Payload with a Payload_Version above the current Payload_Version leaves the input library unmodified.
8. THE Test_Suite SHALL include a test asserting that the Cloud_Newer_Condition evaluates true when the row timestamp exceeds the Last_Synced_Marker and false when the two values are equal.
9. THE Test_Suite SHALL include a test asserting that absent Supabase_Env_Vars resolve to Local_Only_Mode.
10. THE Test_Suite SHALL pass under `npm test`, and THE Resume_Editor SHALL compile under `npm run build` and report no findings under `npm run lint`.
