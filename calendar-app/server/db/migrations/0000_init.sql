CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`person_id` text NOT NULL,
	`source_type` text NOT NULL,
	`config_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `display_state` (
	`display_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`calendar_id` text NOT NULL,
	`uid` text NOT NULL,
	`recurrence_id` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`display_title` text NOT NULL,
	`description` text,
	`location` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`start_date` text,
	`end_date` text,
	`person_ids` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_calendar_uid_recurrence_idx` ON `events` (`calendar_id`,`uid`,`recurrence_id`);--> statement-breakpoint
CREATE INDEX `events_start_at_idx` ON `events` (`start_at`);--> statement-breakpoint
CREATE INDEX `events_calendar_start_at_idx` ON `events` (`calendar_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `photo_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_asset_id` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`orientation` text NOT NULL,
	`taken_at` integer,
	`cache_file` text,
	`cache_bytes` integer,
	`fetched_at` integer,
	`last_shown_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `photo_assets_provider_idx` ON `photo_assets` (`provider`);--> statement-breakpoint
CREATE INDEX `photo_assets_last_shown_at_idx` ON `photo_assets` (`last_shown_at`);--> statement-breakpoint
CREATE TABLE `special_days` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`month` integer NOT NULL,
	`day` integer NOT NULL,
	`year` integer,
	`repeat` text NOT NULL,
	`lead` text NOT NULL,
	`tile_art` text,
	`takeover` integer DEFAULT false NOT NULL,
	`full_art` text,
	`greeting` text,
	`palette` text DEFAULT 'warm' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "special_days_month_check" CHECK("special_days"."month" between 1 and 12),
	CONSTRAINT "special_days_day_check" CHECK("special_days"."day" between 1 and 31),
	CONSTRAINT "special_days_year_check" CHECK(("special_days"."repeat" = 'once') = ("special_days"."year" is not null))
);
--> statement-breakpoint
CREATE TABLE `sync_status` (
	`calendar_id` text PRIMARY KEY NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_error` text,
	`etag` text,
	`last_modified` text,
	`event_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
