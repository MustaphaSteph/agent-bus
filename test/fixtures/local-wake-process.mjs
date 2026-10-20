import { wakeInbox } from "../../dist/bus.js";
import { getDb, closeDb } from "../../dist/db.js";

if (process.argv[2] === "lock") {
  getDb().exec("BEGIN IMMEDIATE");
  process.send({ ready: true });
  process.once("message", () => {
    getDb().exec("ROLLBACK"); closeDb(); process.send({ released: true }); process.disconnect();
  });
} else {
  const result = await wakeInbox({ agent: "race-local", wait_s: 0 }, new AbortController().signal);
  console.log(JSON.stringify(result)); closeDb();
}
