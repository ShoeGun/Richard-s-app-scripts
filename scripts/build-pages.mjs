import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of ['index.html', 'style.css', 'script.js', 'portfolio.css', 'portfolio.js', 'profile.jpg', 'profile1.jpg', 'resume.txt', 'Richard-Jones-resume.pdf', 'Richard-Jones-resume.docx']) {
  await cp(join(root, file), join(dist, file));
}

await cp(join(root, 'public', 'favicon.svg'), join(dist, 'favicon.svg'));
await cp(join(root, 'public', 'project-previews'), join(dist, 'project-previews'), { recursive: true });

await mkdir(join(dist, 'data'), { recursive: true });
await cp(join(root, 'public', 'data', 'demo.csv'), join(dist, 'data', 'demo.csv'));
