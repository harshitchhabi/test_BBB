ALTER TABLE "trade_lines" ALTER COLUMN "from_team_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "counterparty_team_id" DROP NOT NULL;