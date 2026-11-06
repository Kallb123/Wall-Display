CREATE TABLE `photo_renditions` (
	`asset_id` text NOT NULL,
	`rendition` text NOT NULL,
	`cache_file` text NOT NULL,
	`cache_bytes` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`last_shown_at` integer,
	PRIMARY KEY(`asset_id`, `rendition`),
	FOREIGN KEY (`asset_id`) REFERENCES `photo_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `photo_renditions_cache_file_idx` ON `photo_renditions` (`cache_file`);--> statement-breakpoint
-- The files already cached are 2560×1440 renders, so they become the landscape rendition.
INSERT INTO `photo_renditions` (`asset_id`, `rendition`, `cache_file`, `cache_bytes`, `fetched_at`, `last_shown_at`) SELECT `id`, 'landscape', `cache_file`, coalesce(`cache_bytes`, 0), coalesce(`fetched_at`, `created_at`), `last_shown_at` FROM `photo_assets` WHERE `cache_file` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `photo_assets` DROP COLUMN `cache_file`;--> statement-breakpoint
ALTER TABLE `photo_assets` DROP COLUMN `cache_bytes`;--> statement-breakpoint
ALTER TABLE `photo_assets` DROP COLUMN `fetched_at`;