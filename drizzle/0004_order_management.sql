CREATE TABLE `document_sequences` (
	`restaurant_id` text NOT NULL,
	`kind` text NOT NULL,
	`prefix` text NOT NULL,
	`last_number` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`restaurant_id`, `kind`),
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_sequences_number_check" CHECK("document_sequences"."last_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE `order_item_addons` (
	`id` text PRIMARY KEY NOT NULL,
	`order_item_id` text NOT NULL,
	`addon_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`price` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`addon_id`) REFERENCES `menu_addons`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_item_addons_price_check" CHECK("order_item_addons"."price" >= 0)
);
--> statement-breakpoint
CREATE INDEX `order_item_addons_item_idx` ON `order_item_addons` (`order_item_id`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`order_id` text NOT NULL,
	`menu_item_id` text NOT NULL,
	`variant_id` text,
	`item_name` text NOT NULL,
	`variant_name` text,
	`food_type` text NOT NULL,
	`unit_price` integer NOT NULL,
	`addon_total` integer DEFAULT 0 NOT NULL,
	`quantity` integer NOT NULL,
	`line_total` integer NOT NULL,
	`notes` text,
	`status` text DEFAULT 'NEW' NOT NULL,
	`sent_at` integer,
	`cancel_reason` text,
	`cancelled_at` integer,
	`cancelled_by` text,
	`station_id` text,
	`tax_name` text,
	`tax_rate_bps` integer,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `menu_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_items_quantity_check" CHECK("order_items"."quantity" between 1 and 99),
	CONSTRAINT "order_items_price_check" CHECK("order_items"."unit_price" >= 0 and "order_items"."addon_total" >= 0 and "order_items"."line_total" >= 0)
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`order_number` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`table_id` text,
	`guest_count` integer,
	`customer_name` text,
	`customer_phone` text,
	`delivery_address` text,
	`notes` text,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`confirmed_at` integer,
	`cancel_reason` text,
	`cancelled_at` integer,
	`cancelled_by` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_table_check" CHECK(("orders"."type" = 'DINE_IN') = ("orders"."table_id" is not null)),
	CONSTRAINT "orders_subtotal_check" CHECK("orders"."subtotal" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_restaurant_number_unique` ON `orders` (`restaurant_id`,`order_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_open_table_unique` ON `orders` (`table_id`) WHERE "orders"."table_id" is not null and "orders"."deleted_at" is null and "orders"."status" not in ('COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_table_idx` ON `orders` (`table_id`);--> statement-breakpoint
CREATE INDEX `orders_created_idx` ON `orders` (`created_at`);