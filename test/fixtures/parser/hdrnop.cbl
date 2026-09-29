       IDENTIFICATION DIVISION.
       PROGRAM-ID. HDRNOP.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-A PIC X.
       01 WS-B PIC X.
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM STEP-ONE
           PERFORM STEP-TWO
           PERFORM LAST-PART
           GOBACK.
       STEP-ONE.
           MOVE WS-A
               TO WS-B
      *
       STEP-TWO.
           IF WS-A = WS-B
               MOVE WS-B TO WS-A
           END-IF
       LAST-PART SECTION.
       LAST-PARA.
           MOVE WS-B TO
               WS-A.
