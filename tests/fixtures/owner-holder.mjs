import { PaperStore } from '../../src/store.ts'

const store = new PaperStore(process.argv[2], 1_000_000)
await store.start()
process.stdout.write('holding\n')
setInterval(() => {}, 1_000)
