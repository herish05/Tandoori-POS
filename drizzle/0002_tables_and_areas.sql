CREATE TABLE `areas` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`floor` text,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `areas_restaurant_name_unique` ON `areas` (`restaurant_id`,`name`) WHERE "areas"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `dining_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`area_id` text NOT NULL,
	`table_number` text NOT NULL,
	`display_name` text NOT NULL,
	`capacity` integer NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'AVAILABLE' NOT NULL,
	`position_x` integer DEFAULT 0 NOT NULL,
	`position_y` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`opened_at` integer,
	`opened_by` text,
	`guest_count` integer,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dining_tables_capacity_check" CHECK("dining_tables"."capacity" between 1 and 50)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_restaurant_number_unique` ON `dining_tables` (`restaurant_id`,`table_number`) WHERE "dining_tables"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_cell_unique` ON `dining_tables` (`area_id`,`position_x`,`position_y`) WHERE "dining_tables"."deleted_at" is null and "dining_tables"."is_active" = 1;--> statement-breakpoint
CREATE INDEX `dining_tables_area_idx` ON `dining_tables` (`area_id`);