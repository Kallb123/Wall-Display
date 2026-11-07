CREATE TABLE `custom_layouts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`landscape` text NOT NULL,
	`portrait` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_layouts_name_idx` ON `custom_layouts` (lower("name"));