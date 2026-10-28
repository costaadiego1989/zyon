export type Grant={kind:"model"|"tool";resource:string;roles:string[];sources:string[]};
export type GovernancePolicy={merchantId:string;version:number;mode:string;grants:Grant[]|null;models:string[];tools:string[]};
export type GovernanceTask={id:string;merchantId:string;taskType:string;teamId:string|null;status:string;startedAt:string;elapsedMs:number|null;observedHumanMs:number|null;baselineHumanMs:number|null};
export type GovernanceReport={
  tasks:{total:string;completed:string;failed:string;pending:string;withBaseline:string;withHumanObservation:string;estimatedHumanMsAvoided:string|null;observedExecutionMs:string|null;observedHumanMs:string|null};
  costs:Array<{currency:string;costStatus:string;costMicros:string;calls:string}>;
  breakdown:Array<{merchantId:string;teamId:string|null;actorRole:string|null;source:string;calls:string;pendingUsage:string}>;
  decisions:Array<{allowed:boolean;reason:string;_count:{_all:number}}>;
  recentTasks:GovernanceTask[];
};
