CREATE TABLE `photo_playlists` (
	`display_id` text NOT NULL,
	`provider` text NOT NULL,
	`order` text DEFAULT '[]' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`display_id`, `provider`)
);
