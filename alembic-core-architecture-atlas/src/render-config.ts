// 阅读与显式验证共用配置；修改配置将使旧渲染回执失效。
export const renderConfig = {
  startOnLoad: false,
  htmlLabels: false,
  securityLevel: 'strict' as const,
  theme: 'base' as const,
  fontFamily: 'system-ui, sans-serif',
  flowchart: { htmlLabels: false, curve: 'linear' as const, useMaxWidth: false },
  themeVariables: {
    primaryColor: '#f0f5f7',
    primaryBorderColor: '#718a99',
    primaryTextColor: '#142935',
    lineColor: '#607d8b',
    fontSize: '16px',
  },
};
