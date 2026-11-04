CREATE TABLE `preference_overrides` (
	`scope` text PRIMARY KEY NOT NULL,
	`values` text NOT NULL,
	`updated_at` integer NOT NULL
);
