/**
 * 适配包配置：默认值 + cordis.patch.yml 行 config 覆盖（与 kokoa 插件先例同构）。
 * 全部有默认值；未知子键透传保留（不静默吞配置）。
 */
export interface AdapterConfig {
    enabled: boolean;
    context: {
        mode: 'session' | 'shared';
    };
    /** 各 workspace 一个子目录（内含 memory.db）。 */
    workspaces_root: string;
    /** 未显式指定时的 workspace 名。 */
    default_workspace: string;
    /** 本实例写入者身份（agent_id）。 */
    agent_id: string;
    budgets: {
        max_nodes: number;
        max_tokens: number;
    };
    inject: {
        section_order: number;
    };
    recall: {
        view: 'raw' | 'curated';
    };
    tools: {
        recall: boolean;
        write: boolean;
        max_obs_chars: number;
    };
    /** 宿主工具结果自动 observe 入网（dsh-tools 'tools/result' 事件桥；写纪律不破——仅宿主路径）。 */
    auto_observe: {
        enabled: boolean;
        /** 结果摘要截断上限（字符）。 */
        max_chars: number;
        /** 参数摘要截断上限（字符）。 */
        args_chars: number;
        /** 失败结果也入网（失败是同样有价值的协作事实）。 */
        include_error: boolean;
        /** 嵌套 dispatch（exec.parent 存在）也入网；默认只观察根调用。 */
        include_nested: boolean;
    };
}
type Dict = Record<string, unknown>;
/** 默认配置（骨架建议值；dsh cordis.patch.yml 行 config 可覆盖）。 */
export declare function resolveConfig(raw?: Dict): AdapterConfig;
/** workspace 名 → 目录（物理隔离一个名一个目录；名内禁路径分隔符，防越出 root）。 */
export declare function workspaceDir(cfg: AdapterConfig, name?: string): string;
export {};
