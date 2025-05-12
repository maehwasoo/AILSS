export const DEFAULT_GRAPH_CONFIG = {
    "collapse-filter": false,
    "search": "",
    "showTags": false,
    "showAttachments": true,
    "hideUnresolved": false,
    "showOrphans": true,
    "collapse-color-groups": true,
    "collapse-display": true,
    "showArrow": true,
    "textFadeMultiplier": 0.5,
    "nodeSizeMultiplier": 1,
    "lineSizeMultiplier": 0.7,
    "collapse-forces": true,
    "centerStrength": 0.6,
    "repelStrength": 9,
    "linkStrength": 1,
    "linkDistance": 35,
    "scale": 1.25,

    "localJumps": 1,
    "localBacklinks": true,
    "localForelinks": true,
    "localInterlinks": true,
    
    "colorGroups": [
        {
            "query": "[\"depth\":0]",
            "color": {
              "a": 1,
              "rgb": 10403583
            }
          },
          {
            "query": "[\"depth\":1]",
            "color": {
              "a": 1,
              "rgb": 6588919
            }
          },
          {
            "query": "[\"depth\":2]",
            "color": {
              "a": 1,
              "rgb": 3500029
            }
          },
          {
            "query": "[\"depth\":3]",
            "color": {
              "a": 1,
              "rgb": 1858802
            }
          }
    ],
    "close": true
} as const; 