PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_special_days` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`month` integer NOT NULL,
	`day` integer NOT NULL,
	`year` integer,
	`repeat` text NOT NULL,
	`lead` text NOT NULL,
	`lead_days` integer,
	`tile_art` text,
	`takeover` integer DEFAULT false NOT NULL,
	`full_art` text,
	`greeting` text,
	`palette` text DEFAULT 'warm' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "special_days_month_check" CHECK("__new_special_days"."month" between 1 and 12),
	CONSTRAINT "special_days_day_check" CHECK("__new_special_days"."day" between 1 and 31),
	CONSTRAINT "special_days_year_check" CHECK(("__new_special_days"."repeat" = 'once') = ("__new_special_days"."year" is not null)),
	CONSTRAINT "special_days_lead_days_check" CHECK(("__new_special_days"."lead" = 'days') = ("__new_special_days"."lead_days" is not null) and ("__new_special_days"."lead_days" is null or "__new_special_days"."lead_days" between 1 and 365))
);
--> statement-breakpoint
INSERT INTO `__new_special_days`("id", "name", "month", "day", "year", "repeat", "lead", "lead_days", "tile_art", "takeover", "full_art", "greeting", "palette", "created_at", "updated_at") SELECT "id", "name", "month", "day", "year", "repeat", "lead", NULL, "tile_art", "takeover", "full_art", "greeting", "palette", "created_at", "updated_at" FROM `special_days`;--> statement-breakpoint
DROP TABLE `special_days`;--> statement-breakpoint
ALTER TABLE `__new_special_days` RENAME TO `special_days`;--> statement-breakpoint
PRAGMA foreign_keys=ON;