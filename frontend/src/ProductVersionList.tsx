import { useState } from "react";

import type { ProductVersion } from "./projectsApi";

type ProductVersionListProps = {
  versions: ProductVersion[];
  onOpen: (version: ProductVersion) => void;
  onEdit: (
    versionId: number,
    name: string,
    description: string,
  ) => Promise<boolean>;
  onDelete: (version: ProductVersion) => void;
};

export function ProductVersionList({
  versions,
  onOpen,
  onEdit,
  onDelete,
}: ProductVersionListProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  if (versions.length === 0)
    return <p className="workspace-empty">还没有产品版本</p>;

  return (
    <div className="version-list">
      {versions.map((version) => {
        const editing = editingId === version.id;
        return (
          <article className="version-card" key={version.id}>
            <div>
              <h4>{version.version}</h4>
              {!editing && <p>{version.name || "未填写版本名称"}</p>}
              {!editing && version.description && <p>{version.description}</p>}
            </div>
            {editing ? (
              <div className="version-edit-form">
                <label>
                  版本名称 {version.version}
                  <input
                    aria-label={`版本名称 ${version.version}`}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label>
                  版本描述 {version.version}
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    void onEdit(version.id, name, description).then((saved) => {
                      if (saved) setEditingId(null);
                    })
                  }
                >
                  保存 {version.version}
                </button>
              </div>
            ) : (
              <div className="workspace-actions">
                <button type="button" onClick={() => onOpen(version)}>
                  打开 {version.version}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(version.id);
                    setName(version.name);
                    setDescription(version.description);
                  }}
                >
                  编辑 {version.version}
                </button>
                <button type="button" onClick={() => onDelete(version)}>
                  删除 {version.version}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
