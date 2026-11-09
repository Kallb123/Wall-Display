CREATE TABLE `star_chart_people` (
	`person_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`period` text DEFAULT 'week' NOT NULL,
	`goal` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT "star_chart_people_period_check" CHECK("star_chart_people"."period" in ('day', 'week')),
	CONSTRAINT "star_chart_people_goal_check" CHECK("star_chart_people"."goal" is null or "star_chart_people"."goal" >= 1)
);
--> statement-breakpoint
CREATE TABLE `star_counts` (
	`person_id` text NOT NULL,
	`date` text NOT NULL,
	`count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`person_id`, `date`),
	CONSTRAINT "star_counts_count_check" CHECK("star_counts"."count" >= 0)
);
