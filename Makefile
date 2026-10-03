.PHONY: check test run
check:
	bun run check
test:
	bun test
run:
	bun run start -- $(ARGS)
