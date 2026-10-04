MVCLEN   CSECT
         STM   14,12,12(13)
         LR    12,15
         USING MVCLEN,12
         L     2,0(,1)
         LH    3,0(,2)
         BCTR  3,0
         EX    3,MOVE
         LM    14,12,12(13)
         SR    15,15
         BR    14
MOVE     MVC   OUT(0),2(2)
OUT      DS    CL80
         END
