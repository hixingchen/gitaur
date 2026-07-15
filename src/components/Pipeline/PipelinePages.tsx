import { useState } from 'react';
import { Button, Space, Modal, Typography, theme } from 'antd';
import {
  DeleteOutlined, StopOutlined, PlusOutlined,
  CheckCircleOutlined, RocketOutlined,
} from '@ant-design/icons';
import { usePipelineStore, type PipelineTask } from '../../stores/pipelineStore';

const { Text } = Typography;

export function FinishedPage({ task, onNewTask }: { task: PipelineTask; onNewTask: () => void }) {
  const { token } = theme.useToken();
  const deleteTask = usePipelineStore((s) => s.deleteTask);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isSuccess = task.status === 'success';
  const icon = isSuccess
    ? <CheckCircleOutlined style={{ fontSize: 56, color: token.colorSuccess }} />
    : <StopOutlined style={{ fontSize: 56, color: token.colorWarning }} />;

  const title = isSuccess ? '任务完成' : '任务已取消';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '60vh', gap: 20,
    }}>
      {icon}
      <div style={{ fontSize: 18, fontWeight: 600, color: token.colorText }}>{title}</div>
      <Text type="secondary">{task.name} · {task.branchName}</Text>
      <Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={onNewTask}>
          新建任务
        </Button>
        <Button icon={<DeleteOutlined />} onClick={() => setConfirmOpen(true)}>
          清除记录
        </Button>
      </Space>

      <Modal
        title="清除任务记录"
        open={confirmOpen}
        onOk={async () => {
          await deleteTask(task.id);
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
        okText="清除"
        okType="danger"
        cancelText="取消"
        centered
      >
        <p>确定清除任务 <strong>{task.name}</strong> 的记录？</p>
      </Modal>
    </div>
  );
}

export function EmptyPage({ onNewTask }: { onNewTask: () => void }) {
  const { token } = theme.useToken();

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '60vh', gap: 20,
    }}>
      <RocketOutlined style={{ fontSize: 56, color: token.colorTextQuaternary }} />
      <div style={{ fontSize: 16, color: token.colorTextSecondary }}>开始一个新任务</div>
      <Button type="primary" icon={<PlusOutlined />} size="large" onClick={onNewTask}>
        新建任务
      </Button>
    </div>
  );
}
