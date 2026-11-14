CREATE TABLE `photo_pools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sources` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_pools_name_idx` ON `photo_pools` (lower("name"));