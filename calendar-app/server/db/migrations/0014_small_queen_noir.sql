CREATE TABLE `photo_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_id` text NOT NULL,
	`rendition` text NOT NULL,
	`asset_id` text NOT NULL,
	`feed` text NOT NULL,
	`source` text NOT NULL,
	`shown_at` integer NOT NULL,
	`ended_at` integer,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`orientation` text NOT NULL,
	`taken_at` integer,
	`credit` text,
	`details` text,
	`cache_file` text
);
--> statement-breakpoint
CREATE INDEX `photo_history_display_idx` ON `photo_history` (`display_id`,`id`);--> statement-breakpoint
ALTER TABLE `photo_assets` ADD `details` text;