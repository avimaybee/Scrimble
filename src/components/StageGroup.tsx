import React from 'react';

interface StageGroupData {
  label: string;
  type: string;
  status: string;
}

export default function StageGroup({ data }: { data: StageGroupData }) {
  return (
    <div className={`stage-group stage-group--${data.type.toLowerCase()}`}>
      <div className="stage-group-label">
        <span className="stage-group-dash" />
        {data.label.toUpperCase()}
      </div>
    </div>
  );
}
