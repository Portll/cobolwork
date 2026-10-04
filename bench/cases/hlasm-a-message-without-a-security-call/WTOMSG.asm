WTOMSG   CSECT
         STM   14,12,12(13)
         LR    12,15
         USING WTOMSG,12
         WTO   'CW001I SECURITY CHECK DONE ELSEWHERE'
         LM    14,12,12(13)
         SR    15,15
         BR    14
         END
