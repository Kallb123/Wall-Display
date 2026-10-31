CREATE TABLE `special_day_scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`lead` text NOT NULL,
	`lead_days` integer,
	`tile_art` text,
	`takeover` integer DEFAULT false NOT NULL,
	`full_art` text,
	`greeting` text,
	`palette` text DEFAULT 'warm' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "special_day_scenes_lead_days_check" CHECK(("special_day_scenes"."lead" = 'days' and "special_day_scenes"."lead_days" is not null and "special_day_scenes"."lead_days" between 1 and 365) or ("special_day_scenes"."lead" <> 'days' and "special_day_scenes"."lead_days" is null))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_special_days` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`month` integer NOT NULL,
	`day` integer NOT NULL,
	`year` integer,
	`repeat` text NOT NULL,
	`scene_id` text,
	`who` text,
	`since_year` integer,
	`lead` text,
	`lead_days` integer,
	`tile_art` text,
	`takeover` integer,
	`full_art` text,
	`extra_art` text,
	`greeting` text,
	`palette` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `special_day_scenes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "special_days_month_check" CHECK("__new_special_days"."month" between 1 and 12),
	CONSTRAINT "special_days_day_check" CHECK("__new_special_days"."day" between 1 and 31),
	CONSTRAINT "special_days_year_check" CHECK(("__new_special_days"."repeat" = 'once') = ("__new_special_days"."year" is not null)),
	CONSTRAINT "special_days_lead_days_check" CHECK(("__new_special_days"."lead" is null and "__new_special_days"."lead_days" is null) or ("__new_special_days"."lead" is not null and "__new_special_days"."lead" = 'days' and "__new_special_days"."lead_days" is not null and "__new_special_days"."lead_days" between 1 and 365) or ("__new_special_days"."lead" is not null and "__new_special_days"."lead" <> 'days' and "__new_special_days"."lead_days" is null)),
	CONSTRAINT "special_days_since_year_check" CHECK("__new_special_days"."since_year" is null or ("__new_special_days"."repeat" = 'yearly' and "__new_special_days"."since_year" between 1900 and 2100))
);
--> statement-breakpoint
INSERT INTO `__new_special_days`("id", "name", "month", "day", "year", "repeat", "scene_id", "who", "since_year", "lead", "lead_days", "tile_art", "takeover", "full_art", "extra_art", "greeting", "palette", "created_at", "updated_at") SELECT "id", "name", "month", "day", "year", "repeat", NULL, NULL, NULL, "lead", "lead_days", "tile_art", "takeover", "full_art", NULL, "greeting", "palette", "created_at", "updated_at" FROM `special_days`;--> statement-breakpoint
DROP TABLE `special_days`;--> statement-breakpoint
ALTER TABLE `__new_special_days` RENAME TO `special_days`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `special_days_scene_id_idx` ON `special_days` (`scene_id`);