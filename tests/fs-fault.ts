// Isolated subprocess fault injection at the filesystem adapter boundary.
import { mock } from "bun:test";
import * as fs from "node:fs";

const real = { ...fs };
const phase = process.env.FINANCIAL_CLI_TEST_FS_FAULT;
const isSession = (fd: fs.PathOrFileDescriptor) => typeof fd === "number";
mock.module("node:fs", () => ({
	...real,
	writeFileSync: (
		fd: fs.PathOrFileDescriptor,
		data: string | NodeJS.ArrayBufferView,
		options?: fs.WriteFileOptions,
	) => {
		if (phase === "write" && isSession(fd)) {
			real.writeFileSync(fd, "PARTIAL-SECRET");
			throw new Error("Injected write failure");
		}
		return real.writeFileSync(fd, data, options);
	},
	fsyncSync: (fd: number) => {
		if (phase === "fsync") throw new Error("Injected fsync failure");
		if (phase === "slow-fsync")
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
		return real.fsyncSync(fd);
	},
	renameSync: (from: fs.PathLike, to: fs.PathLike) => {
		if (phase === "rename") throw new Error("Injected rename failure");
		return real.renameSync(from, to);
	},
}));
