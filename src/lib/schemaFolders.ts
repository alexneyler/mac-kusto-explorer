export interface FolderEntity {
  name: string;
  folder?: string;
}

export interface SchemaFolder<T extends FolderEntity> {
  name: string;
  path: string;
  folders: SchemaFolder<T>[];
  entities: T[];
}

export interface FolderContents<T extends FolderEntity> {
  folders: SchemaFolder<T>[];
  entities: T[];
}

interface MutableFolder<T extends FolderEntity> {
  name: string;
  path: string;
  folders: Map<string, MutableFolder<T>>;
  entities: T[];
}

/** Group ADX entities by slash- or backslash-delimited Folder metadata. */
export function groupByFolder<T extends FolderEntity>(
  entities: T[],
): FolderContents<T> {
  const root: MutableFolder<T> = {
    name: "",
    path: "",
    folders: new Map(),
    entities: [],
  };

  for (const entity of entities) {
    const segments = (entity.folder ?? "")
      .split(/[\\/]+/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    let parent = root;
    for (const segment of segments) {
      const path = parent.path ? `${parent.path}/${segment}` : segment;
      let folder = parent.folders.get(segment);
      if (!folder) {
        folder = {
          name: segment,
          path,
          folders: new Map(),
          entities: [],
        };
        parent.folders.set(segment, folder);
      }
      parent = folder;
    }
    parent.entities.push(entity);
  }

  return freezeFolder(root);
}

function freezeFolder<T extends FolderEntity>(
  folder: MutableFolder<T>,
): FolderContents<T> {
  const folders = [...folder.folders.values()]
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    )
    .map((child) => {
      const contents = freezeFolder(child);
      return {
        name: child.name,
        path: child.path,
        ...contents,
      };
    });
  return { folders, entities: folder.entities };
}
