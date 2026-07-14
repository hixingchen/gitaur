import { Tag } from 'antd';

/** GitLab MR 状态标签 */
export function getStateTag(state: string) {
  switch (state) {
    case 'opened':
      return <Tag color="success">打开</Tag>;
    case 'closed':
      return <Tag color="default">关闭</Tag>;
    case 'merged':
      return <Tag color="processing">已合并</Tag>;
    default:
      return <Tag>{state}</Tag>;
  }
}

/** GitLab MR 合并状态标签 */
export function getMergeStatusTag(status: string) {
  switch (status) {
    case 'mergeable':
      return <Tag color="success">可合并</Tag>;
    case 'checking':
      return <Tag color="processing">检查中</Tag>;
    case 'conflict':
      return <Tag color="error">有冲突</Tag>;
    case 'not_mergeable':
      return <Tag color="warning">不可合并</Tag>;
    default:
      return null;
  }
}
