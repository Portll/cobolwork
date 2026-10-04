BALRCALL CSECT
         STM   14,12,12(13)
         LR    12,15
         USING BALRCALL,12
         LA    15,SUB
         BALR  14,15
         LM    14,12,12(13)
         SR    15,15
         BR    14
SUB      BR    14
         END
