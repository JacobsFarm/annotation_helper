import type { Project, ProjectFile } from '@shared/project'
import { allowRoot } from '../protocol'
import {
  createProject,
  ensureLayout,
  openProject,
  saveProject,
  writeDataYaml
} from '../services/project-service'
import { loadSettings, rememberProject } from '../services/settings-service'
import { handle } from './handle'

/** Opening a project is also what grants `ah-img://` access to its folder. */
async function adopt(project: Project): Promise<Project> {
  allowRoot(project.root)
  await ensureLayout(project)
  await rememberProject(project.root, project.name)
  return project
}

handle('project.create', async (input: { root: string; name: string; task: ProjectFile['task'] }) =>
  adopt(await createProject(input))
)

handle('project.open', async (root: string) => adopt(await openProject(root)))

handle('project.save', async (project: Project) => {
  const saved = await saveProject(project)
  await writeDataYaml(saved)
  return saved
})

handle('project.recent', async () => (await loadSettings()).recent)
