-- Rolls back 0033_perfumer_chats.sql (#180): every saved AI perfumer chat is lost.
DROP TABLE "perfumer_messages";--> statement-breakpoint
DROP TABLE "perfumer_threads";
