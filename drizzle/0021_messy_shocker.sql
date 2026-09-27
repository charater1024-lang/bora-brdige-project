CREATE TABLE `phishing_reputation_lookup_quotas` (
	`subject_hash` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`request_count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "phishing_reputation_lookup_quotas_subject_check" CHECK(length("phishing_reputation_lookup_quotas"."subject_hash") = 64),
	CONSTRAINT "phishing_reputation_lookup_quotas_count_check" CHECK("phishing_reputation_lookup_quotas"."request_count" >= 0)
);
