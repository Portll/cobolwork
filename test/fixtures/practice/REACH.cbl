       IDENTIFICATION DIVISION.
       PROGRAM-ID. REACH.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-N PIC 9 VALUE 0.
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM DO-WORK THRU DO-WORK-EXIT.
           PERFORM IN-SECTION.
           IF WS-N = 1
               GO TO JUMPED-TO
           END-IF.
           STOP RUN.
       DO-WORK.
           ADD 1 TO WS-N.
           GO TO DO-WORK-EXIT.
       SKIPPED-OVER.
           DISPLAY 'NEVER RUNS'.
       DO-WORK-EXIT.
           EXIT.
       JUMPED-TO.
           DISPLAY 'JUMPED'.
           GOBACK.
       NOBODY-CALLS.
           DISPLAY 'NOBODY'.
       IN-SECTION SECTION.
       FIRST-IN-SECTION.
           DISPLAY 'FIRST'.
       SECOND-IN-SECTION.
           DISPLAY 'SECOND'.
       DEAD-SECTION SECTION.
       DEAD-SECTION-PARA.
           DISPLAY 'DEAD SECTION'.
