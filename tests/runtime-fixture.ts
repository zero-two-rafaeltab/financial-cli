export async function deadline<A>(
	promise: Promise<A>,
	milliseconds = 2000,
): Promise<A> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Synthetic fixture deadline exceeded")),
					milliseconds,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export async function runChild(
	command: readonly string[],
	options: {
		readonly cwd: string;
		readonly env: Record<string, string | undefined>;
	},
) {
	const child = Bun.spawn([...command], {
		...options,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	try {
		const [out, err, code] = await deadline(output, 3000);
		return { out, err, code };
	} finally {
		if (child.exitCode === null) child.kill("SIGKILL");
		await deadline(output, 1000);
	}
}
